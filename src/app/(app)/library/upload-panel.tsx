"use client";

import { useActionState, useRef, useState, type DragEvent } from "react";
import { requestUploadUrl, saveDocument } from "./actions";
import { INITIAL_UPLOAD_STATE } from "./upload-state";
import { chunkDocument } from "@/lib/ingest/chunk";
import { assessExtraction, isAcceptedFilename } from "@/lib/ingest/extract";
import { extractTextFromFile } from "@/lib/ingest/pdf-client";
import {
  DOCUMENT_KIND_LABELS,
  DocumentUpload,
  readUploadFormValues,
  sourceTypeForKind,
  toUploadFieldErrors,
  type UploadFieldErrors,
} from "@/lib/schemas/document-upload";
import {
  DocumentId,
  DocumentKind,
  REJECTION_MESSAGES,
  type DocumentChunk,
} from "@/lib/schemas";

/**
 * Chunk ids are `documentId#ordinal`, and the real document id is minted
 * server-side. The preview only ever shows ordinal, section and text, so a
 * fixed placeholder keeps it deterministic and makes clear that nothing here
 * is the stored identity.
 */
const PREVIEW_DOCUMENT_ID = DocumentId.parse(
  "00000000-0000-4000-8000-000000000000",
);

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly filename: string }
  | { readonly kind: "refused"; readonly filename: string; readonly message: string }
  | {
      readonly kind: "ready";
      readonly filename: string;
      readonly pageCount: number;
      readonly text: string;
      readonly chunks: readonly DocumentChunk[];
    };

function fieldClass(invalid: boolean): string {
  return [
    "mt-1 w-full rounded-soft border bg-paper px-2 py-1.5 text-base",
    invalid ? "border-ink" : "border-rule",
  ].join(" ");
}

export function UploadPanel() {
  const [state, formAction, pending] = useActionState(
    saveDocument,
    INITIAL_UPLOAD_STATE,
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [clientErrors, setClientErrors] = useState<UploadFieldErrors>({});
  const [kind, setKind] = useState<string>("ccds");
  /**
   * Which file the last submit was for.
   *
   * Without this the panel keeps showing the preview and a live save button
   * after a successful save, and a second click writes the same document
   * again under a fresh id. Comparing against the current phase means the
   * preview reappears the moment a different file is chosen, with no effect
   * and no reset button.
   */
  const [submittedFilename, setSubmittedFilename] = useState<string | null>(null);

  /**
   * Set once the browser has PUT the bytes straight to R2.
   *
   * Two hidden fields rather than one flag: the Server Action re-derives the
   * key from the id and refuses the pair if they do not match, so sending both
   * is what makes the claim checkable. See requestUploadUrl in ./actions.
   */
  const [presigned, setPresigned] = useState<
    { readonly documentId: string; readonly objectKey: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const errors: UploadFieldErrors =
    Object.keys(clientErrors).length > 0 ? clientErrors : state.errors;

  /**
   * Read a file entirely in the browser.
   *
   * The "needs OCR" decision happens here, before anything is uploaded — a
   * reviewer should not wait for a round trip to be told their scan is
   * unreadable. The server repeats the check anyway, because this one is a
   * courtesy and that one is the rule.
   */
  async function ingest(file: File) {
    if (!isAcceptedFilename(file.name)) {
      setPhase({
        kind: "refused",
        filename: file.name,
        message: REJECTION_MESSAGES.unsupported_format,
      });
      return;
    }

    setPhase({ kind: "reading", filename: file.name });
    try {
      const raw = await extractTextFromFile(file);
      const assessment = assessExtraction(raw);
      if (!assessment.ok) {
        setPhase({
          kind: "refused",
          filename: file.name,
          message: assessment.message,
        });
        return;
      }
      const chunks = chunkDocument(assessment.text, {
        documentId: PREVIEW_DOCUMENT_ID,
        sourceType: sourceTypeForKind(
          DocumentKind.safeParse(kind).success
            ? DocumentKind.parse(kind)
            : "ccds",
        ),
      });
      setPhase({
        kind: "ready",
        filename: file.name,
        pageCount: assessment.pageCount,
        text: assessment.text,
        chunks,
      });
    } catch {
      setPhase({
        kind: "refused",
        filename: file.name,
        message: REJECTION_MESSAGES.extraction_failed,
      });
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file === null) return;
    // Put the dropped file into the real <input> so the form submits it the
    // ordinary way. Keeping one source of truth for "the chosen file" avoids
    // the classic bug where the preview shows one document and the upload
    // sends another.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (fileInput.current !== null) fileInput.current.files = transfer.files;
    void ingest(file);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (phase.kind !== "ready") {
      event.preventDefault();
      setClientErrors({ file: "Add a document first." });
      return;
    }
    const parsed = DocumentUpload.safeParse(
      readUploadFormValues(new FormData(form)),
    );
    if (!parsed.success) {
      event.preventDefault();
      setClientErrors(toUploadFieldErrors(parsed.error));
      return;
    }

    setClientErrors({});

    // Already sent the bytes straight to R2 — let the form go, carrying only
    // metadata and the extracted text.
    if (presigned !== null) {
      setSubmittedFilename(phase.filename);
      return;
    }

    const file = fileInput.current?.files?.item(0) ?? null;
    if (file === null) {
      setSubmittedFilename(phase.filename);
      return;
    }

    // Stop this submit, try the direct upload, then submit again. Awaiting
    // inside the handler is not an option: a submit event cannot be held open,
    // and React would have dispatched the action before the PUT finished.
    event.preventDefault();
    void uploadDirectThenSubmit(form, file, parsed.data.kind);
  }

  /**
   * Browser to R2, no Worker in the middle.
   *
   * Falls back to the ordinary Server Action on ANY failure — credentials not
   * configured, a network error, a non-2xx from R2. The fallback still works
   * and is merely slower and size-capped, so there is no case where a reviewer
   * is told to try again because of how we chose to move the bytes.
   */
  async function uploadDirectThenSubmit(
    form: HTMLFormElement,
    file: File,
    kind: string,
  ) {
    setUploading(true);
    try {
      const grant = await requestUploadUrl({
        kind,
        filename: file.name,
        contentType: file.type,
      });

      if (grant.mode === "presigned") {
        const response = await fetch(grant.upload.url, {
          method: "PUT",
          // Must match what was signed, byte for byte. R2 checks it.
          headers: { "content-type": grant.upload.contentType },
          body: file,
        });
        if (response.ok) {
          setPresigned({
            documentId: grant.documentId,
            objectKey: grant.upload.key,
          });
        }
      }
    } catch {
      // Deliberately silent to the reviewer: the fallback path is about to run
      // and succeed, and an error message about an optimisation they did not
      // ask for is noise.
    } finally {
      setUploading(false);
      setSubmittedFilename(phase.kind === "ready" ? phase.filename : null);
      form.requestSubmit();
    }
  }

  /** True once THIS file has been stored, so the save button retires. */
  const alreadySaved =
    state.status === "saved" &&
    phase.kind === "ready" &&
    submittedFilename === phase.filename;

  const sourceType = sourceTypeForKind(
    DocumentKind.safeParse(kind).success ? DocumentKind.parse(kind) : "ccds",
  );

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate>
      {presigned !== null && (
        <>
          <input
            type="hidden"
            name="presignedDocumentId"
            value={presigned.documentId}
          />
          <input
            type="hidden"
            name="presignedObjectKey"
            value={presigned.objectKey}
          />
        </>
      )}
      {/* ---------------------------------------------------------------- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "rounded-soft border border-dashed px-4 py-6 text-center",
          dragging ? "border-steady bg-steady-wash" : "border-rule",
        ].join(" ")}
      >
        <p className="text-base">
          Drag a document here, or{" "}
          <label className="cursor-pointer text-steady underline">
            choose a file
            <input
              ref={fileInput}
              type="file"
              name="file"
              accept=".pdf,.md,.txt"
              className="sr-only"
              onChange={(e) => {
                const file = e.currentTarget.files?.item(0);
                if (file != null) void ingest(file);
              }}
            />
          </label>
          .
        </p>
        <p className="mt-1 text-meta text-slate">
          PDF, Markdown or plain text. The text is read here in your browser —
          the file itself is not sent until you save.
        </p>
      </div>

      {errors.file !== undefined && (
        <p className="mt-2 text-meta font-medium text-ink">{errors.file}</p>
      )}

      {/* ---------------------------------------------------------------- */}
      {phase.kind === "reading" && (
        <p className="mt-4 text-base text-slate">
          Reading {phase.filename}…
        </p>
      )}

      {phase.kind === "refused" && (
        <div className="mt-4 border-l-2 border-ink bg-row-hover px-3 py-2">
          <p className="text-micro uppercase tracking-label text-slate">
            {phase.filename} was not accepted
          </p>
          <p className="mt-1 text-base font-medium">{phase.message}</p>
        </div>
      )}

      {phase.kind === "ready" && !alreadySaved && (
        <>
          <input type="hidden" name="extractedText" value={phase.text} />
          <input type="hidden" name="pageCount" value={phase.pageCount} />
          {/* What the preview showed. The pipeline computes the real count
              from the same chunker; this is only so the confirmation matches
              what the reviewer was just looking at. */}
          <input
            type="hidden"
            name="chunkCount"
            value={phase.chunks.length}
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="u-title" className="text-base font-medium">
                Title
              </label>
              <input
                id="u-title"
                name="title"
                type="text"
                defaultValue={state.values.title}
                placeholder="Hepalex CCDS v7.2"
                aria-invalid={errors.title !== undefined}
                className={fieldClass(errors.title !== undefined)}
              />
              {errors.title !== undefined && (
                <p className="mt-1 text-meta font-medium text-ink">
                  {errors.title}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="u-substance" className="text-base font-medium">
                Active substance
              </label>
              <input
                id="u-substance"
                name="activeSubstance"
                type="text"
                defaultValue={state.values.activeSubstance}
                placeholder="hepalexin"
                aria-invalid={errors.activeSubstance !== undefined}
                className={fieldClass(errors.activeSubstance !== undefined)}
              />
              {errors.activeSubstance !== undefined && (
                <p className="mt-1 text-meta font-medium text-ink">
                  {errors.activeSubstance}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="u-kind" className="text-base font-medium">
                Document kind
              </label>
              <select
                id="u-kind"
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.currentTarget.value)}
                className={fieldClass(errors.kind !== undefined)}
              >
                {DocumentKind.options.map((option) => (
                  <option key={option} value={option}>
                    {DOCUMENT_KIND_LABELS[option]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-meta text-slate">
                Filed as{" "}
                <span
                  className={
                    sourceType === "company" ? "text-steady" : "text-ink"
                  }
                >
                  {sourceType}
                </span>
                . This follows from the kind and cannot be set separately.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="u-version" className="text-base font-medium">
                  Version
                </label>
                <input
                  id="u-version"
                  name="version"
                  type="text"
                  defaultValue={state.values.version}
                  placeholder="7.2"
                  className={fieldClass(false)}
                />
              </div>
              <div>
                <label htmlFor="u-effective" className="text-base font-medium">
                  Effective
                </label>
                <input
                  id="u-effective"
                  name="effectiveDate"
                  type="date"
                  defaultValue={state.values.effectiveDate}
                  className={fieldClass(errors.effectiveDate !== undefined)}
                />
              </div>
            </div>
          </div>

          <ChunkPreview
            filename={phase.filename}
            pageCount={phase.pageCount}
            chars={phase.text.length}
            chunks={phase.chunks}
          />

          <button
            type="submit"
            disabled={pending || uploading}
            className="mt-6 cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-wait disabled:opacity-60"
          >
            {uploading
              ? "Uploading the file…"
              : pending
                ? "Saving…"
                : `Save document and ${phase.chunks.length} chunks`}
          </button>
          {uploading && (
            <p className="mt-1 text-meta text-slate">
              The file is going straight to storage from your browser.
            </p>
          )}
        </>
      )}

      {state.status === "saved" && state.saved !== null && (
        <div className="mt-4 border-l-2 border-steady bg-steady-wash px-3 py-2">
          <p className="text-base font-medium">
            Saved {state.saved.title} — {state.saved.chunkCount} chunks.
          </p>
          <p className="mt-1 font-mono text-meta text-slate">
            {state.saved.objectKey}
          </p>
          <p className="mt-1 text-meta text-slate">
            Drop another document above to add one more.
          </p>
        </div>
      )}

      {errors.form !== undefined && (
        <p className="mt-4 text-base font-medium text-ink">{errors.form}</p>
      )}
    </form>
  );
}

/**
 * The chunks, exactly as chunkDocument produced them.
 *
 * Showing this before saving is the point of the screen: a reviewer can see
 * that section headings were understood, that ordinals are contiguous, and
 * that no passage was cut mid-sentence — all before anything is committed to
 * the library.
 */
function ChunkPreview({
  filename,
  pageCount,
  chars,
  chunks,
}: {
  filename: string;
  pageCount: number;
  chars: number;
  chunks: readonly DocumentChunk[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? chunks : chunks.slice(0, 8);

  return (
    <section className="mt-6" aria-label="Chunk preview">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-1">
        <h3 className="text-micro uppercase tracking-label text-slate">
          Chunks
        </h3>
        <p className="text-meta text-slate">
          {filename} · {pageCount} {pageCount === 1 ? "page" : "pages"} ·{" "}
          {chars.toLocaleString()} chars · {chunks.length} chunks
        </p>
      </div>

      <ol className="mt-1">
        {shown.map((chunk) => (
          <li
            key={chunk.id}
            className="grid grid-cols-[3rem_1fr] gap-3 border-b border-rule py-2"
          >
            <div className="text-meta text-slate">
              <div className="font-mono">{chunk.ordinal}</div>
              <div>{chunk.tokenEstimate}t</div>
            </div>
            <div>
              <p className="text-micro uppercase tracking-label text-slate">
                {chunk.section ?? "no section"}
              </p>
              <p className="mt-0.5 text-meta">
                {chunk.text.length > 240
                  ? `${chunk.text.slice(0, 240)}…`
                  : chunk.text}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {chunks.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 cursor-pointer text-meta text-steady hover:underline"
        >
          {expanded
            ? "Show fewer"
            : `Show all ${chunks.length} chunks`}
        </button>
      )}
    </section>
  );
}

"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { chunkDocument } from "@/lib/ingest/chunk";
import { assessExtraction, isAcceptedFilename } from "@/lib/ingest/extract";
import {
  DocumentUpload,
  readUploadFormValues,
  sourceTypeForKind,
  toUploadFieldErrors,
} from "@/lib/schemas/document-upload";
import { DocumentId, REJECTION_MESSAGES, SafetyDocument } from "@/lib/schemas";
import { getDocumentStore, objectKeyFor } from "@/lib/store/document-store";
import { getDocumentLibrary } from "@/lib/store/library-store";
import {
  presignUpload,
  presignedUploadsAvailable,
  type PresignedUpload,
} from "@/lib/store/presign";
import { sourceTypeForKind as sourceTypeFor } from "@/lib/schemas/document-upload";
import type { UploadState } from "./upload-state";

/**
 * Hand the browser a URL it may PUT one file to.
 *
 * The document id and the object key are minted HERE, server-side, and the
 * client never chooses either. The key's prefix is the confidentiality
 * namespace — `company/` or `public/` — so a client that could name its own
 * key could presign a write into the company namespace and have the result
 * treated as a confidential source document for the rest of its life.
 *
 * Returns null when R2's S3 credentials are not configured, which is the
 * signal to the client to fall back to posting the bytes through the Server
 * Action. See lib/store/presign.ts.
 */
export async function requestUploadUrl(input: {
  readonly kind: string;
  readonly filename: string;
  readonly contentType: string;
}): Promise<
  | { readonly mode: "presigned"; readonly documentId: string; readonly upload: PresignedUpload }
  | { readonly mode: "server_action" }
> {
  const session = await requireSession();

  const kind = DocumentUpload.shape.kind.safeParse(input.kind);
  if (!kind.success || !isAcceptedFilename(input.filename)) {
    return { mode: "server_action" };
  }
  if (!(await presignedUploadsAvailable())) return { mode: "server_action" };

  const documentId = DocumentId.parse(crypto.randomUUID());
  const key = objectKeyFor(
    sourceTypeFor(kind.data),
    documentId,
    input.filename,
  );

  const upload = await presignUpload(
    key,
    input.contentType === "" ? "application/octet-stream" : input.contentType,
  );
  if (upload === null) return { mode: "server_action" };

  audit({
    actor: session.reviewerId,
    action: "presign_upload",
    target: key,
    outcome: "success",
    detail: { expiresInSeconds: upload.expiresInSeconds },
  });

  return { mode: "presigned", documentId, upload };
}

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Accept an uploaded safety document.
 *
 * A note on trust. The extracted text arrives from the client, because
 * extraction genuinely has to happen there — pdf.js is a browser library and
 * pdf-parse imports `fs`, which is the whole reason CLAUDE.md specifies
 * client-side extraction. So the server cannot independently re-derive the
 * text, and this input is strictly untrusted.
 *
 * What the server does instead is re-run every check that does not need the
 * PDF: the metadata schema, the file type, the size, and — importantly —
 * assessExtraction, so a client that skipped the "needs OCR" check cannot get
 * a scanned document into the library by going around the UI. The remaining
 * exposure is a signed-in reviewer sending text that does not match their
 * PDF, which is a different threat model from the anonymous public form, and
 * one the audit line records.
 */
export async function saveDocument(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await requireSession();
  const values = readUploadFormValues(formData);

  const parsed = DocumentUpload.safeParse(values);
  if (!parsed.success) {
    return {
      status: "invalid",
      errors: toUploadFieldErrors(parsed.error),
      values,
      saved: null,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "invalid",
      errors: { file: "Choose a file to upload." },
      values,
      saved: null,
    };
  }
  if (!isAcceptedFilename(file.name)) {
    return {
      status: "invalid",
      errors: { file: REJECTION_MESSAGES.unsupported_format },
      values,
      saved: null,
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      status: "invalid",
      errors: {
        file: `That file is ${(file.size / 1_048_576).toFixed(1)} MB. The limit here is 8 MB.`,
      },
      values,
      saved: null,
    };
  }

  const extractedText = formData.get("extractedText");
  const rawPageCount = Number(formData.get("pageCount"));
  const assessment = assessExtraction({
    pageCount: Number.isFinite(rawPageCount) ? rawPageCount : 0,
    text: typeof extractedText === "string" ? extractedText : "",
  });

  const sourceType = sourceTypeForKind(parsed.data.kind);

  /**
   * Did the browser already PUT the bytes to R2?
   *
   * The client sends back the id and key it was given by requestUploadUrl.
   * Both are re-derived here rather than trusted: the id must be a uuid, and
   * the key must be exactly the key this id and source type produce. That
   * makes the field unforgeable without re-implementing the check — a client
   * claiming `company/<another-document>.pdf` gets a mismatch and is treated
   * as not having uploaded anything.
   */
  const claimedId = formData.get("presignedDocumentId");
  const claimedKey = formData.get("presignedObjectKey");
  const presignedId =
    typeof claimedId === "string"
      ? DocumentId.safeParse(claimedId)
      : { success: false as const };

  const documentId = presignedId.success
    ? presignedId.data
    : DocumentId.parse(crypto.randomUUID());
  const objectKey = objectKeyFor(sourceType, documentId, file.name);
  const alreadyUploaded =
    presignedId.success &&
    typeof claimedKey === "string" &&
    claimedKey === objectKey;

  try {
    // The original is kept even when the text turns out unusable: a scanned
    // document is exactly the one someone will want to run OCR over later,
    // and discarding the bytes would mean asking the reviewer to find the
    // file again.
    if (!alreadyUploaded) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await (await getDocumentStore()).put(objectKey, bytes, {
        contentType: file.type === "" ? "application/octet-stream" : file.type,
        filename: file.name,
      });
    }
  } catch {
    audit({
      actor: session.reviewerId,
      action: "upload_document",
      target: objectKey,
      outcome: "failure",
    });
    return {
      status: "error",
      errors: { form: "The file could not be stored. Nothing was saved." },
      values,
      saved: null,
    };
  }

  if (!assessment.ok) {
    const rejected = SafetyDocument.parse({
      id: documentId,
      title: parsed.data.title,
      kind: parsed.data.kind,
      sourceType,
      activeSubstance: parsed.data.activeSubstance,
      version: parsed.data.version,
      effectiveDate: parsed.data.effectiveDate,
      objectKey,
      status: "rejected",
      rejectionReason: assessment.reason,
      chunkCount: 0,
      uploadedAt: new Date().toISOString(),
    });
    await (await getDocumentLibrary()).save({ document: rejected, chunks: [] });

    audit({
      actor: session.reviewerId,
      action: "upload_document",
      target: documentId,
      outcome: "rejected",
      detail: { reason: assessment.reason },
    });
    revalidatePath("/library");
    return {
      status: "rejected",
      errors: { file: assessment.message },
      values,
      saved: null,
    };
  }

  const chunks = chunkDocument(assessment.text, { documentId, sourceType });

  const document = SafetyDocument.parse({
    id: documentId,
    title: parsed.data.title,
    kind: parsed.data.kind,
    sourceType,
    activeSubstance: parsed.data.activeSubstance,
    version: parsed.data.version,
    effectiveDate: parsed.data.effectiveDate,
    objectKey,
    // Chunked, not embedded. There is no Vectorize this session, and marking
    // it "embedded" would be a lie a later cluster has to unpick.
    status: "chunking",
    rejectionReason: null,
    chunkCount: chunks.length,
    uploadedAt: new Date().toISOString(),
  });

  await (await getDocumentLibrary()).save({ document, chunks });

  audit({
    actor: session.reviewerId,
    action: "upload_document",
    target: documentId,
    outcome: "success",
    detail: {
      sourceType,
      kind: parsed.data.kind,
      chunks: chunks.length,
      pages: assessment.pageCount,
    },
  });

  revalidatePath("/library");
  return {
    status: "saved",
    errors: {},
    values,
    saved: { title: document.title, chunkCount: chunks.length, objectKey },
  };
}

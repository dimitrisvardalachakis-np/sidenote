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
import { sha256 } from "@/lib/ingest/hash";
import { duplicateMessage, findDuplicate } from "@/lib/library/duplicates";
import { resolveAiBinding } from "@/lib/assess/ai";
import { aiEnv } from "@/lib/assess/env";
import { embedAndUpsert } from "@/lib/retrieval/ingest";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import type { UploadState } from "./upload-state";

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
      duplicate: null,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "invalid",
      errors: { file: "Choose a file to upload." },
      values,
      saved: null,
      duplicate: null,
    };
  }
  if (!isAcceptedFilename(file.name)) {
    return {
      status: "invalid",
      errors: { file: REJECTION_MESSAGES.unsupported_format },
      values,
      saved: null,
      duplicate: null,
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
      duplicate: null,
    };
  }

  const extractedText = formData.get("extractedText");
  const rawPageCount = Number(formData.get("pageCount"));
  const assessment = assessExtraction({
    pageCount: Number.isFinite(rawPageCount) ? rawPageCount : 0,
    text: typeof extractedText === "string" ? extractedText : "",
  });

  /*
    ALREADY HELD? — asked here, which is BEFORE the R2 write below.

    Order is the whole point. A refusal after the put leaves an object in the
    bucket that no document row references, and the reviewer is told nothing
    was saved while something was. Everything this check needs is already in
    hand: the text came up from the browser with the form.

    A rejected extraction has no hash and is never a duplicate — a scanned PDF
    with no text layer is not "the same as" anything, and hashing the empty
    string would make every one of them identical to every other.
  */
  const contentHash = assessment.ok ? await sha256(assessment.text) : null;

  if (assessment.ok) {
    /*
      The whole library, scanned in memory. Six rows today, and the natural-key
      half wants a compound match that no single index serves — so this stays a
      scan rather than a pair of queries whose cost is the same at this size.
      A library of thousands wants `documents_content_hash_idx` and a lookup;
      the index is already there for that day.
    */
    const held = await (await getDocumentLibrary()).list();
    const clash = findDuplicate(held, {
      contentHash,
      activeSubstance: parsed.data.activeSubstance,
      kind: parsed.data.kind,
      version: parsed.data.version,
    });

    /*
      `confirmSupersedes` is read straight off the FormData rather than through
      `DocumentUpload`, and deliberately: it is not a property of the document.
      It is one reviewer acknowledging one warning on one submission, it must
      never reach a stored record, and putting it in the entity schema — the
      schema non-negotiable #2 has the client form and this action share —
      would mean the client validating a field about our storage.

      It only ever excuses `same_version`. Identical text has no acknowledgement
      that makes a second copy worth having.
    */
    const acknowledged = formData.get("confirmSupersedes") === "on";
    const refuse =
      clash !== null && !(clash.kind === "same_version" && acknowledged);

    if (refuse && clash !== null) {
      audit({
        actor: session.reviewerId,
        action: "upload_document",
        target: clash.held.id,
        outcome: "rejected",
        detail: { reason: clash.kind, heldSince: clash.held.uploadedAt },
      });
      return {
        status: "duplicate",
        errors: {},
        values,
        saved: null,
        duplicate: {
          kind: clash.kind,
          message: duplicateMessage(clash),
          heldTitle: clash.held.title,
          heldDocumentId: clash.held.id,
        },
      };
    }
  }

  const documentId = DocumentId.parse(crypto.randomUUID());
  const sourceType = sourceTypeForKind(parsed.data.kind);
  const objectKey = objectKeyFor(sourceType, documentId, file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    // The original is kept even when the text turns out unusable: a scanned
    // document is exactly the one someone will want to run OCR over later,
    // and discarding the bytes would mean asking the reviewer to find the
    // file again.
    await (await getDocumentStore()).put(objectKey, bytes, {
      contentType: file.type === "" ? "application/octet-stream" : file.type,
      filename: file.name,
    });
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
      duplicate: null,
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
      // Null by construction here: `contentHash` is only computed for an
      // extraction that succeeded, and this branch is the one where it did not.
      contentHash,
      chunkCount: 0,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session.reviewerId,
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
      duplicate: null,
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
    /*
      Chunked. Not yet embedded, and deliberately written that way first.

      The mirror is saved before the vectors are attempted, because the two
      failure modes are not symmetric: a document in the library but not the
      index is lexically searchable and honestly labelled, while a document in
      the index but not the library is a vector that can never be hydrated.
      Given a crash between the two, the first is strictly better — so the
      status starts pessimistic and is corrected upwards only if the upsert
      actually resolved.
    */
    status: "chunking",
    rejectionReason: null,
    contentHash,
    chunkCount: chunks.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: session.reviewerId,
  });

  await (await getDocumentLibrary()).save({ document, chunks });

  const env = await aiEnv();
  const ingest = await embedAndUpsert({
    dense: resolveDenseFor(env, resolveAiBinding(env)),
    document,
    chunks,
  });

  // The only path in the codebase that writes "embedded", and it is downstream
  // of an upsert that resolved. A comment cannot keep that status honest; this
  // control flow can.
  if (ingest.status === "embedded") {
    await (await getDocumentLibrary()).save({
      document: SafetyDocument.parse({ ...document, status: "embedded" }),
      chunks,
    });
  }

  audit({
    actor: session.reviewerId,
    action: "upload_document",
    target: documentId,
    // Still a success. The document is stored, chunked, mirrored and
    // searchable; whether the dense half saw it is a separate fact, recorded
    // separately, and never a reason to tell a reviewer their upload failed.
    outcome: "success",
    detail: {
      sourceType,
      kind: parsed.data.kind,
      chunks: chunks.length,
      pages: assessment.pageCount,
      embedding: ingest.status,
      vectors: ingest.status === "embedded" ? ingest.vectors : 0,
      embeddingDetail: ingest.status === "embedded" ? "none" : ingest.reason,
    },
  });

  revalidatePath("/library");
  return {
    status: "saved",
    errors: {},
    values,
    saved: { title: document.title, chunkCount: chunks.length, objectKey },
    duplicate: null,
  };
}

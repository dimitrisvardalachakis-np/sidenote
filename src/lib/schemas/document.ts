/**
 * SafetyDocument and DocumentChunk.
 *
 * These two carry the `company` / `public` split that the whole evidence panel
 * is built on. A company document is a confidential CCDS or Investigator's
 * Brochure someone uploaded; a public document is an FDA label fetched from
 * openFDA. They are never mixed, and every chunk restates which it came from
 * so a citation can be rendered without a second lookup.
 */
import { z } from "zod";
import {
  ChunkId,
  DocumentId,
  ReviewerId,
  IsoDate,
  IsoDateTime,
  SourceType,
} from "./primitives";

/**
 * What kind of document this is. The first two are `company` sourceType, the
 * third is `public` — the pairing is enforced below rather than left to
 * whoever writes the insert.
 */
export const DocumentKind = z.enum([
  "ccds", // Company Core Data Sheet — marketed products
  "investigators_brochure", // investigational products
  "fda_label", // public, from openFDA
]);
export type DocumentKind = z.output<typeof DocumentKind>;

/**
 * Where a document is in the pipeline. Cluster E turns these into queue
 * states; for now they are what the library screen renders.
 *
 * `chunking` and `embedded` are the two a reviewer actually sees, and the
 * difference between them is which searches can find the document — keyword
 * only, or keyword and semantic. Only `library/actions.ts` and the backfill
 * write `embedded`, and only downstream of an upsert that resolved: a document
 * labelled `embedded` with no vectors would tell a reviewer that "no matching
 * passage" is a fact about the document when it is a fact about the index.
 */
export const IngestionStatus = z.enum([
  "pending", // uploaded, nothing done yet
  "extracting", // pulling text out
  "chunking", // mirrored and keyword-searchable; not embedded
  "embedded", // vectors in the index and chunks mirrored — both searches work
  "rejected", // will never be usable; see rejectionReason
]);
export type IngestionStatus = z.output<typeof IngestionStatus>;

/**
 * Why a document was refused. `no_text_layer` is the scanned-PDF case
 * CLAUDE.md calls out: rejected loudly with "needs OCR" rather than ingested
 * as zero chunks, which would look like a document that simply mentions
 * nothing.
 */
export const RejectionReason = z.enum([
  "no_text_layer",
  "unsupported_format",
  "empty_document",
  "extraction_failed",
]);
export type RejectionReason = z.output<typeof RejectionReason>;

/** The message shown to a reviewer, fixed here so it reads identically everywhere. */
export const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  no_text_layer:
    "This PDF has no text layer — it needs OCR before it can be used.",
  unsupported_format: "This file type cannot be read. Upload a PDF, MD, or TXT.",
  empty_document: "This document contains no readable text.",
  extraction_failed: "The text could not be extracted from this file.",
};

export const SafetyDocument = z
  .object({
    id: DocumentId,
    title: z.string().min(1).max(300),
    kind: DocumentKind,
    sourceType: SourceType,
    /** Active substance this document governs, used to route retrieval. */
    activeSubstance: z.string().min(1).max(200),
    /**
     * Version as printed on the document, e.g. "CCDS v7.2". Public FDA labels
     * use their SPL version instead; either way it is what the reviewer cites.
     */
    version: z.string().min(1).max(60).nullable(),
    effectiveDate: IsoDate.nullable(),
    /**
     * R2 object key. Per CLAUDE.md the Worker only ever stores the key — the
     * bytes go browser-to-R2 through a presigned URL and never pass through
     * application code. Null while the upload is still in flight.
     */
    objectKey: z.string().min(1).max(512).nullable(),
    status: IngestionStatus,
    rejectionReason: RejectionReason.nullable(),
    /** Populated once extraction succeeds; drives the "N chunks" readout. */
    chunkCount: z.int().nonnegative(),
    uploadedAt: IsoDateTime,
    /**
     * Which reviewer put it here, or null when nobody did.
     *
     * Null is the honest value for a public label fetched from openFDA the
     * moment a medicine was named: no reviewer chose to add it, and writing
     * one in would attribute a decision to somebody who never made it. The
     * library says "fetched from openFDA" for those rather than a name.
     *
     * Nullable with a default so documents stored before this field existed
     * still parse — the same reasoning as `narrative` on a finding. A stored
     * document that fails to parse disappears from the library, which is a
     * steep price for an additive field.
     */
    uploadedBy: ReviewerId.nullable().default(null),
    /**
     * SHA-256 of the extracted text, or null when it is not known.
     *
     * Null for every document stored before this field existed, and for a
     * rejected one — a scanned PDF has no text to be the same as anything.
     * Nullable with a default for the reason `uploadedBy` is: a stored document
     * that fails to parse disappears from the library, which is a steep price
     * for an additive field.
     */
    contentHash: z.string().length(64).nullable().default(null),
  })
  .refine(
    (doc) =>
      doc.kind === "fda_label"
        ? doc.sourceType === "public"
        : doc.sourceType === "company",
    {
      message:
        "An FDA label must be public; a CCDS or Investigator's Brochure must be company",
      path: ["sourceType"],
    },
  )
  .refine(
    (doc) => (doc.status === "rejected") === (doc.rejectionReason !== null),
    {
      message: "A rejected document needs a reason, and only a rejected one has one",
      path: ["rejectionReason"],
    },
  );
export type SafetyDocument = z.output<typeof SafetyDocument>;

/**
 * One retrievable passage.
 *
 * The five fields CLAUDE.md names — documentId, sourceType, section, ordinal,
 * text — are all here, plus the offsets back into the extracted text. The
 * offsets exist so a citation can be traced to its exact position in the
 * source rather than re-found by string search, which would land on the wrong
 * occurrence in any document that repeats a phrase. Safety documents repeat
 * phrases constantly.
 *
 * This is the exact return shape of `chunkDocument` in step 6, so the chunker
 * and the retrieval layer cannot drift apart.
 */
export const DocumentChunk = z
  .object({
    id: ChunkId,
    documentId: DocumentId,
    sourceType: SourceType,
    /** Heading path this chunk sits under, e.g. "4.8 Undesirable effects". */
    section: z.string().min(1).max(300).nullable(),
    /** Position within the document, 0-based and gapless. */
    ordinal: z.int().nonnegative(),
    text: z.string().min(1),
    charStart: z.int().nonnegative(),
    charEnd: z.int().nonnegative(),
    /** Approximate; the real count depends on the embedding tokenizer. */
    tokenEstimate: z.int().nonnegative(),
  })
  .refine((c) => c.charEnd > c.charStart, {
    message: "charEnd must be greater than charStart",
    path: ["charEnd"],
  });
export type DocumentChunk = z.output<typeof DocumentChunk>;

/**
 * What `chunkDocument` needs to know about the document it is splitting.
 * Kept deliberately small: the chunker is a pure function and must not need a
 * database, a fetch, or a platform binding to do its job.
 */
export const ChunkMeta = z.object({
  documentId: DocumentId,
  sourceType: SourceType,
});
export type ChunkMeta = z.output<typeof ChunkMeta>;

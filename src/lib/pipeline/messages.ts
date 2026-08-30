import { z } from "zod";
import { CaseId, DocumentId } from "@/lib/schemas/primitives";

/**
 * What travels on the queue.
 *
 * CLAUDE.md's pipeline is "Extract → chunk → embed → dedupe → assess", and
 * these are the seams between those steps. Extraction is not here because it
 * happens in the browser — pdf.js is a browser library, which is the whole
 * reason CLAUDE.md specifies client-side extraction — so the queue picks the
 * work up at chunking.
 *
 * MESSAGES CARRY IDS, NEVER PAYLOADS.
 *
 * A Queues message is capped at 128 KB. The extracted text of a 40-page CCDS
 * is comfortably larger than that, and a message that is *usually* small
 * enough is a pipeline that works in testing and fails on the document
 * somebody actually cares about. So the text goes to R2 and the message says
 * where.
 *
 * The messages are also SMALL ON PURPOSE beyond that limit: a queue message is
 * retried, and a retry re-reads whatever the ids point at. Carrying a snapshot
 * of the data would mean a retry silently re-processing a stale copy of it.
 */

export const IngestMessage = z.discriminatedUnion("kind", [
  /**
   * Chunk a document whose text is already in R2, mirror the chunks into D1,
   * and ask for them to be embedded.
   */
  z.object({
    kind: z.literal("chunk_document"),
    documentId: DocumentId,
    /** R2 key of the extracted text, written by the upload action. */
    textKey: z.string().min(1).max(512),
  }),

  /**
   * Embed this document's chunks and upsert them into Vectorize.
   *
   * Separate from chunking rather than folded into it, because the two fail
   * for different reasons and should be retried independently: chunking is
   * pure and deterministic, embedding is a model call that can be rate
   * limited, time out, or cost money. Retrying a model call because a database
   * write failed is the kind of coupling that shows up on a bill.
   */
  z.object({
    kind: z.literal("embed_document"),
    documentId: DocumentId,
  }),

  /**
   * Run retrieval for a case and write the assessment.
   *
   * The last step, and the one that turns "not assessed" in the queue into
   * evidence a reviewer can read. Still not a decision — the assessment holds
   * findings with citations, and `ruling` stays null until a human fills it.
   */
  z.object({
    kind: z.literal("assess_case"),
    caseId: CaseId,
  }),
]);
export type IngestMessage = z.output<typeof IngestMessage>;

/**
 * How many times the platform retries before the message goes to the DLQ.
 *
 * Matches `max_retries` in wrangler.jsonc. Kept here as well because the
 * consumer's logging says "attempt 2 of 3", and a number that disagrees with
 * the platform's is worse than no number.
 */
export const MAX_RETRIES = 3;

/**
 * ModelReading — what a language model reports a retrieved passage says.
 *
 * This is the shape of the only thing the model is permitted to produce, and
 * the fields that are *absent* are the point. CLAUDE.md non-negotiable #4 says
 * the model never decides. It does not say the model never speaks. The line
 * between the two is drawn here:
 *
 *   - there is no `determination`, so a reading cannot say "listed"
 *   - there is no `serious`, so a reading cannot start a 15-day clock
 *   - a `read` reading cannot be constructed without a chunk id and a span
 *
 * A reading is evidence about a document. The verdict is `ReviewerRuling`, and
 * only a human writes one. This shape is CLAUDE.md non-negotiable #5.
 *
 * The three states are kept apart for the same reason the retrieval states
 * are. "The model read the passages and none describes this reaction" is a
 * reading a reviewer can weigh. "The model could not be reached" is not, and
 * rendering the second as the first would let an outage look like a finding —
 * the exact failure non-negotiable #8 exists to prevent.
 */
import { z } from "zod";
import { ChunkId, IsoDateTime } from "./primitives";

/**
 * A rationale is one sentence. The cap is characters rather than tokens
 * because it is enforced on a string, and a number a test can assert beats a
 * number that depends on a tokeniser.
 */
export const RATIONALE_MAX_CHARS = 240;

/**
 * Language that turns a reading into a recommendation.
 *
 * "The passage lists hepatic failure" is a reading. "This should be expedited"
 * is a decision wearing a reading's clothes, and it is the specific way a
 * grounded summariser starts doing the reviewer's job. A rationale matching
 * any of these is discarded and the citation kept — the quotation was still
 * verified, and it is the part that carries the evidence.
 *
 * These are prefix patterns, not whole words, and that is the whole point. An
 * earlier version required a word boundary on both ends, so `recommend` did
 * not match "recommended" and `expedite` did not match "expedited" — which let
 * "Expedited reporting is recommended for this reaction" through untouched.
 * A denylist that misses the most natural inflection of its own marker is not
 * a denylist. `should` keeps its trailing boundary because it has no
 * inflections and the prefix form would swallow "shoulder".
 *
 * It is still a blunt instrument: it will not catch every phrasing of a
 * recommendation, and it will occasionally take a harmless sentence with it.
 * Both errors fail safe — towards showing the reviewer a quotation with no
 * gloss on it.
 */
export const RECOMMENDATION_PATTERNS: readonly RegExp[] = [
  /\bshould\b/,
  /\brecommend/, // recommend, recommends, recommended, recommendation
  /\bexpedit/, // expedite, expedited, expediting, expeditious
  /\breport(?:s|ed|ing)?\s+to\b/,
];

/** The markers as the brief words them, for documentation and the evals. */
export const RECOMMENDATION_MARKERS: readonly string[] = [
  "should",
  "recommend",
  "expedite",
  "report to",
];

/** True when a rationale strays into telling the reviewer what to do. */
export function containsRecommendation(text: string): boolean {
  const lower = text.toLowerCase();
  return RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * True when the text is a single sentence.
 *
 * A terminator only ends a sentence when a capital follows it. Without that
 * test — an earlier version had the comment but not the check — "Hepatic
 * events, e.g. jaundice, are described" counts as two sentences and a
 * perfectly good rationale is thrown away. The capital also keeps "2.1% of
 * patients" and "Approx. 3%" intact.
 *
 * It still splits "See section 4.8. Jaundice is listed rarely", and that is
 * correct: those are two sentences.
 */
export function isSingleSentence(text: string): boolean {
  return !/[.!?]["')\]]?\s+[A-Z]/.test(text.trim());
}

/**
 * The rationale field, with its rules attached to the type rather than left to
 * a caller to remember. A rationale that recommends something is not a value
 * this module can hold, so it cannot reach a screen even if the verification
 * step that should have caught it were bypassed.
 */
export const Rationale = z
  .string()
  .min(1)
  .max(RATIONALE_MAX_CHARS)
  .refine((text) => !containsRecommendation(text), {
    message:
      "A rationale reports what a passage says; it does not recommend an action",
  })
  .refine(isSingleSentence, { message: "A rationale is one sentence" });

export const ModelReading = z.discriminatedUnion("status", [
  /**
   * The model identified a passage that describes the reaction.
   *
   * `chunkId` and `quotedSpan` are both required: this variant *is* the
   * citation, and non-negotiable #3 has no exceptions. That the span really
   * occurs in that chunk is checked in code before this value is built —
   * a schema cannot verify it, because the chunk text is not in scope here.
   */
  z.object({
    status: z.literal("read"),
    chunkId: ChunkId,
    /** Copied character-for-character out of the chunk. Never a paraphrase. */
    quotedSpan: z.string().min(1),
    /** Null when the model's sentence was discarded but its citation stood. */
    rationale: Rationale.nullable(),
    model: z.string().min(1),
    /** AI Gateway log id, so a verdict traces to the exact inference. */
    gatewayRequestId: z.string().min(1).nullable(),
    generatedAt: IsoDateTime,
  }),

  /**
   * The model read the retrieved passages and none of them describes the
   * reaction. A finding, and deliberately citation-free: there is no span to
   * quote for an absence, and inventing one to satisfy a schema would be the
   * fabrication this whole design is built to prevent.
   */
  z.object({
    status: z.literal("nothing_found"),
    model: z.string().min(1),
    gatewayRequestId: z.string().min(1).nullable(),
    generatedAt: IsoDateTime,
  }),

  /**
   * No reading could be produced. The model was absent, unreachable, or
   * returned something that failed validation twice.
   *
   * This must never render as "nothing found". The retrieved passages are
   * still shown; what is missing is the model's account of them.
   */
  z.object({
    status: z.literal("unavailable"),
    /** Plain words for the reviewer, e.g. "no AI binding configured". */
    reason: z.string().min(1),
    /** Null when the failure was that no model was reachable at all. */
    model: z.string().min(1).nullable(),
    gatewayRequestId: z.string().min(1).nullable(),
    attemptedAt: IsoDateTime,
  }),
]);
export type ModelReading = z.output<typeof ModelReading>;

/** The citation a reading points at, when it points at one. */
export function readingCitesChunk(reading: ModelReading): string | null {
  return reading.status === "read" ? reading.chunkId : null;
}

/**
 * GroundedNarrative — a short account of several retrieved passages, in which
 * every sentence carries the passage it came from.
 *
 * `ModelReading` reports one passage. This reports two, and it exists
 * because a single quoted sentence does not read as an answer to "what do
 * these documents say about this reaction" — it reads as a quotation, which is
 * what it is. The narrative is the answer, and the whole design problem is
 * making it an answer that cannot lie.
 *
 * WHAT IS ABSENT IS THE DESIGN.
 *
 * There is no top-level `summary` string. That is the structural form of
 * non-negotiable #3: a sentence not attached to a chunk id and a verified span
 * is not a value this module can hold, so "no claim without its citation" is
 * not a rule a renderer has to remember. It is also what makes partial
 * acceptance safe — points are independent, so dropping one leaves nothing
 * dangling. Add a summary field and you have quietly broken both at once.
 *
 * There is no `determination`, no `verdict`, no `confidence`. Non-negotiable
 * #4, unchanged: the model does not decide, and there is nowhere for it to.
 *
 * There is no `nothing_found` state, and this is the subtle one. `ModelReading`
 * already owns "the model read these passages and identified none". A second
 * state saying the same thing would put two things on one screen that can each
 * assert a document is silent, and they could disagree — a `read` reading
 * beside a `nothing_found` narrative is a panel saying two opposite things
 * about the same passages. A missing narrative is `unavailable` (attempted,
 * failed) or null (never attempted). Neither is ever a finding about a
 * document.
 *
 * NOTHING DOWNSTREAM MAY READ THIS. `documentStance`, `readingsDiverge`,
 * `sourcesDisagree`, `ruledListedness`, `requiresExpeditedReport` and
 * `expeditedClock` do not and must not consult a narrative. It is computed
 * last, from values already final, and nothing reads it back. That is the
 * mechanical form of non-negotiable #8: the moment a derived function depends
 * on it, a narrative failure starts blocking a reviewer, and "AI failure must
 * never block a human write" stops being true.
 */
import { z } from "zod";
import { ChunkId, IsoDateTime } from "./primitives";
import {
  containsDetermination,
  containsRecommendation,
  isSingleSentence,
} from "./reading";

/**
 * Two points, 140 characters each.
 *
 * "A few sentences, more than enough, not multi-paragraph" expressed as a
 * number a test can assert rather than as a request in the prompt, because a
 * model may ignore a request. 280 characters is the whole budget.
 *
 * IT WAS THREE AT 240, AND THE REASON IT IS NOT IS LATENCY, NOT TASTE. The
 * model decodes at ~63 ms per output token against a 10s timeout, so ~158
 * tokens is the entire budget for a reply — see NARRATIVE_MAX_OUTPUT_TOKENS,
 * which carries the measurements. Three 240-character points is roughly 445
 * tokens and could not return; two 140-character ones are roughly 130 and can.
 *
 * These two numbers and that one MUST move together. Capping the tokens alone
 * truncates a reply the prompt still asked to be long, which is invalid JSON
 * rather than a shorter narrative; loosening these alone reintroduces the
 * timeout. The cost is honest and worth stating: an account of three passages
 * is now an account of two.
 */
export const NARRATIVE_MAX_POINTS = 2;

/**
 * Its own constant, not a re-export of RATIONALE_MAX_CHARS, and now visibly
 * not equal to it. They bound different things — one gloss on one span versus
 * one point of a multi-point account — and this is the change that proves
 * keeping them separate was right: the narrative's limit came down for a
 * latency reason that has nothing to do with a rationale, and RATIONALE_MAX_CHARS
 * did not have to move with it.
 */
export const NARRATIVE_POINT_MAX_CHARS = 140;

/**
 * One sentence of the narrative.
 *
 * The rules `Rationale` carries, plus the determination gate. See
 * `containsDetermination` for why that gate applies here and not to a rationale:
 * a paragraph has room to reach a verdict in a way one sentence does not.
 */
export const PointSentence = z
  .string()
  .min(1)
  .max(NARRATIVE_POINT_MAX_CHARS)
  .refine((text) => !containsRecommendation(text), {
    message: "A narrative point reports what a passage says; it does not recommend an action",
  })
  .refine((text) => !containsDetermination(text), {
    message: "A narrative point reports what a passage says; it does not reach a determination",
  })
  .refine(isSingleSentence, { message: "A narrative point is one sentence" });

/**
 * One point: a citation and the sentence it supports, inseparable.
 *
 * `strictObject` rather than `object` because zod strips unknown keys by
 * default, and "there is no field in which a determination could be recorded"
 * is only a true statement if an extra key is a parse failure rather than
 * something silently discarded. The model's reply never reaches this schema
 * directly — it goes through the permissive `RawNarrative` first — so
 * strictness costs nothing and buys a claim a test can hold us to.
 *
 * `sentence` rather than `text` so the wire key itself states the cardinality
 * every time the model writes it.
 */
export const NarrativePoint = z.strictObject({
  chunkId: ChunkId,
  /** Copied character-for-character out of the chunk THIS point cites. */
  quotedSpan: z.string().min(1),
  sentence: PointSentence,
});
export type NarrativePoint = z.output<typeof NarrativePoint>;

export const GroundedNarrative = z.discriminatedUnion("status", [
  /**
   * One or two verified points.
   *
   * `.min(1)` — a narrated narrative with no points is not a narrative, and
   * making that unconstructible is what lets the renderer map the array
   * without a special case. `.max()` is the length limit, in the type.
   */
  z.object({
    status: z.literal("narrated"),
    points: z.array(NarrativePoint).min(1).max(NARRATIVE_MAX_POINTS),
    model: z.string().min(1),
    /** AI Gateway log id, so a rendered sentence traces to its inference. */
    gatewayRequestId: z.string().min(1).nullable(),
    generatedAt: IsoDateTime,
  }),

  /**
   * No narrative could be produced. The model was absent, unreachable, or
   * returned nothing that survived verification.
   *
   * This is not a finding that the documents are silent — that claim belongs
   * to `ModelReading` and lives there alone.
   */
  z.object({
    status: z.literal("unavailable"),
    /** Plain words, e.g. "no AI binding configured". */
    reason: z.string().min(1),
    model: z.string().min(1).nullable(),
    gatewayRequestId: z.string().min(1).nullable(),
    attemptedAt: IsoDateTime,
  }),
]);
export type GroundedNarrative = z.output<typeof GroundedNarrative>;


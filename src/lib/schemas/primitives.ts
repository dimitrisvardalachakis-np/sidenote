/**
 * Shared building blocks. Everything else in schemas/ is assembled from here.
 *
 * Two conventions run through this whole directory:
 *
 * 1. Absence is `null`, not `undefined`. zod's `.optional()` emits
 *    `T | undefined`, which means `exactOptionalPropertyTypes` does not
 *    actually distinguish "field omitted" from "field explicitly nothing" on
 *    a zod-derived type. `null` survives JSON.stringify, maps onto a D1
 *    NULL column, and forces every reader to handle the empty case. So a
 *    missing suspect drug is `null`, never a silently absent key.
 *
 * 2. Nothing the model produces is trusted without provenance and a quote.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Identifiers
//
// Branded, so a DocumentId cannot be handed to something expecting a CaseId.
// Both are strings at runtime; only the compiler knows the difference, which
// is exactly the class of mix-up that is invisible in a code review.
// ---------------------------------------------------------------------------

export const CaseId = z.uuid().brand<"CaseId">();
export type CaseId = z.output<typeof CaseId>;

export const ReactionId = z.uuid().brand<"ReactionId">();
export type ReactionId = z.output<typeof ReactionId>;

export const DrugId = z.uuid().brand<"DrugId">();
export type DrugId = z.output<typeof DrugId>;

export const DocumentId = z.uuid().brand<"DocumentId">();
export type DocumentId = z.output<typeof DocumentId>;

export const AssessmentId = z.uuid().brand<"AssessmentId">();
export type AssessmentId = z.output<typeof AssessmentId>;

/** Shared reviewer login. Many humans, one role — see CLAUDE.md "Who uses it". */
export const ReviewerId = z.string().min(1).brand<"ReviewerId">();
export type ReviewerId = z.output<typeof ReviewerId>;

/**
 * Chunk ids are NOT uuids: step 6 requires them to be deterministic, so the
 * same document text always yields the same ids. The derivation lives in the
 * chunker; this type only guarantees it is a non-empty string.
 */
export const ChunkId = z.string().min(1).brand<"ChunkId">();
export type ChunkId = z.output<typeof ChunkId>;

/**
 * The human-facing handle, e.g. "SN-2026-000412". This is what a public
 * reporter is shown on /report/thanks — they will never see a uuid.
 */
export const CaseReference = z
  .string()
  .regex(/^SN-\d{4}-\d{6}$/, "Expected a reference like SN-2026-000412")
  .brand<"CaseReference">();
export type CaseReference = z.output<typeof CaseReference>;

// ---------------------------------------------------------------------------
// Time
//
// Stored as ISO strings rather than Date objects: these cross a Server Action
// boundary, land in D1, and get compared by the nightly cron. A string that
// sorts lexicographically is the least surprising thing at every one of those
// hops.
// ---------------------------------------------------------------------------

/** Calendar date, YYYY-MM-DD. Used where the clock counts whole days. */
export const IsoDate = z.iso.date();
export type IsoDate = z.output<typeof IsoDate>;

/** Instant, RFC3339. Used for audit lines and record timestamps. */
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.output<typeof IsoDateTime>;

// ---------------------------------------------------------------------------
// Provenance — CLAUDE.md non-negotiable #4: the model never decides
// ---------------------------------------------------------------------------

/**
 * Who put a value here. Every model-derived judgement in this codebase is
 * wrapped in something carrying this, so a screen can always render "suggested"
 * differently from "accepted" without guessing.
 */
export const Provenance = z.enum(["model", "reviewer"]);
export type Provenance = z.output<typeof Provenance>;

/**
 * A model suggestion that a human has not yet ruled on. `confirmedByReviewer`
 * starts false for anything the model produced and can only be set by a
 * reviewer action. Nothing renders as fact while it is false.
 */
export function suggestionShape<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    suggestedBy: Provenance,
    confirmedByReviewer: z.boolean(),
    /** Set when a reviewer explicitly rejected the suggestion. */
    rejectedByReviewer: z.boolean(),
  });
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Company-confidential (CCDS, IB) versus public (FDA label). */
export const SourceType = z.enum(["company", "public"]);
export type SourceType = z.output<typeof SourceType>;

/**
 * An exact span inside a case narrative, used to highlight the phrase that
 * triggered a seriousness flag. Offsets are character indices into the
 * narrative string so the UI can mark it without re-searching (and without
 * accidentally highlighting a second, identical phrase further down).
 */
export const NarrativeSpan = z
  .object({
    quote: z.string().min(1),
    start: z.int().nonnegative(),
    end: z.int().nonnegative(),
  })
  .refine((s) => s.end > s.start, {
    message: "end must be greater than start",
    path: ["end"],
  });
export type NarrativeSpan = z.output<typeof NarrativeSpan>;

/**
 * A pointer into an ingested document. This is the shape CLAUDE.md
 * non-negotiable #3 is written in: a chunk id and the quoted span.
 *
 * `sourceType` is required and not derivable here on purpose — "every
 * retrieval result must state which" — so a citation can be rendered with its
 * company/public provenance without a second lookup.
 */
export const Citation = z.object({
  chunkId: ChunkId,
  documentId: DocumentId,
  sourceType: SourceType,
  /** Heading path the chunk came from, e.g. "4.8 Undesirable effects". */
  section: z.string().nullable(),
  /** The exact words. Not a paraphrase, not a summary. */
  quote: z.string().min(1),
});
export type Citation = z.output<typeof Citation>;

/**
 * True when `span.quote` really is the text at those offsets. The UI and the
 * fixtures both use this: a highlight that does not match the narrative is a
 * lie about the source, which is worse than no highlight at all.
 */
export function spanMatchesNarrative(
  narrative: string,
  span: NarrativeSpan,
): boolean {
  return narrative.slice(span.start, span.end) === span.quote;
}

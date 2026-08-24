/**
 * Assessment — listedness against the company document, expectedness against
 * the public FDA label, and the disagreement between them.
 *
 * The shape here does most of the work of CLAUDE.md non-negotiable #3. Rather
 * than requiring every renderer to remember "no citation, no claim", the
 * finding is a discriminated union in which only the `grounded` variant
 * *has* a determination at all, and that variant cannot be constructed with an
 * empty citation list. An uncited claim is not a value this module can
 * produce — there is no field to put it in.
 */
import { z } from "zod";
import {
  AssessmentId,
  CaseId,
  Citation,
  DrugId,
  IsoDateTime,
  Provenance,
  ReactionId,
  ReviewerId,
} from "./primitives";

/** Is the reaction described in the company's core safety document? */
export const ListednessDetermination = z.enum([
  "listed",
  "unlisted",
  "indeterminate",
]);
export type ListednessDetermination = z.output<typeof ListednessDetermination>;

/** Is the reaction described in the public FDA label? */
export const ExpectednessDetermination = z.enum([
  "expected",
  "unexpected",
  "indeterminate",
]);
export type ExpectednessDetermination = z.output<
  typeof ExpectednessDetermination
>;

/**
 * The three states each evidence panel must handle, named once here so the UI
 * and the retrieval layer agree on them:
 *
 *   grounded            we found passages and can show them
 *   no_result           the search ran and found nothing relevant
 *   source_unavailable  the search could not run
 *
 * The last two are different facts and must look different on screen.
 * "Nothing in the CCDS mentions this" is a finding a reviewer can act on;
 * "we could not reach the CCDS" is not. Collapsing them would let an outage
 * masquerade as a clean result — the exact failure non-negotiable #5 is about.
 */
export const RetrievalState = z.enum([
  "grounded",
  "no_result",
  "source_unavailable",
]);
export type RetrievalState = z.output<typeof RetrievalState>;

/** Which company document was consulted. Follows the drug's marketing status. */
export const GoverningDocumentKind = z.enum([
  "ccds",
  "investigators_brochure",
]);
export type GoverningDocumentKind = z.output<typeof GoverningDocumentKind>;

/**
 * Note that citations are required even when the determination is `unlisted`.
 * Asserting absence is still a claim about a document, and the reviewer needs
 * to see *which* section was read in order to trust it — the adverse-reactions
 * table that does not mention the event is the evidence.
 */
export const ListednessFinding = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("grounded"),
      determination: ListednessDetermination,
      documentKind: GoverningDocumentKind,
      citations: z.array(Citation).min(1),
      suggestedBy: Provenance,
      retrievedAt: IsoDateTime,
    })
    .refine((f) => f.citations.every((c) => c.sourceType === "company"), {
      message: "Listedness may only cite company documents",
      path: ["citations"],
    }),
  z.object({
    state: z.literal("no_result"),
    documentKind: GoverningDocumentKind,
    /** The query that ran, so "nothing found" is auditable rather than a shrug. */
    query: z.string().min(1),
    retrievedAt: IsoDateTime,
  }),
  z.object({
    state: z.literal("source_unavailable"),
    documentKind: GoverningDocumentKind,
    /** Plain words for the reviewer, e.g. "Vectorize timed out after 5s". */
    reason: z.string().min(1),
    attemptedAt: IsoDateTime,
  }),
]);
export type ListednessFinding = z.output<typeof ListednessFinding>;

export const ExpectednessFinding = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("grounded"),
      determination: ExpectednessDetermination,
      citations: z.array(Citation).min(1),
      suggestedBy: Provenance,
      /** openFDA SPL set id the label came from. */
      labelSetId: z.string().min(1).nullable(),
      retrievedAt: IsoDateTime,
    })
    .refine((f) => f.citations.every((c) => c.sourceType === "public"), {
      message: "Expectedness may only cite public labels",
      path: ["citations"],
    }),
  z.object({
    state: z.literal("no_result"),
    query: z.string().min(1),
    retrievedAt: IsoDateTime,
  }),
  z.object({
    state: z.literal("source_unavailable"),
    reason: z.string().min(1),
    attemptedAt: IsoDateTime,
  }),
]);
export type ExpectednessFinding = z.output<typeof ExpectednessFinding>;

/**
 * The human ruling. Nullable on the Assessment, and it is the only place a
 * determination becomes the case's answer — non-negotiable #4. The model fills
 * in the findings above; a reviewer fills in this, or nobody does.
 */
export const ReviewerRuling = z.object({
  listedness: ListednessDetermination,
  expectedness: ExpectednessDetermination,
  decidedBy: ReviewerId,
  decidedAt: IsoDateTime,
  /** Why. Free text, required — an unexplained override is not an audit trail. */
  rationale: z.string().min(1).max(4000),
});
export type ReviewerRuling = z.output<typeof ReviewerRuling>;

export const Assessment = z.object({
  id: AssessmentId,
  caseId: CaseId,
  /** Assessment is per reaction-drug pair, not per case. */
  reactionId: ReactionId,
  drugId: DrugId,
  listedness: ListednessFinding,
  expectedness: ExpectednessFinding,
  ruling: ReviewerRuling.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Assessment = z.output<typeof Assessment>;

// ---------------------------------------------------------------------------
// Pure readings of an assessment
// ---------------------------------------------------------------------------

/**
 * The determination that currently stands: the reviewer's if they have ruled,
 * otherwise the model's suggestion, otherwise nothing. Returns null rather
 * than a default, because "we do not yet know" is a state the UI must show
 * rather than paper over.
 */
export function standingListedness(
  assessment: Assessment,
): ListednessDetermination | null {
  if (assessment.ruling !== null) return assessment.ruling.listedness;
  if (assessment.listedness.state === "grounded") {
    return assessment.listedness.determination;
  }
  return null;
}

export function standingExpectedness(
  assessment: Assessment,
): ExpectednessDetermination | null {
  if (assessment.ruling !== null) return assessment.ruling.expectedness;
  if (assessment.expectedness.state === "grounded") {
    return assessment.expectedness.determination;
  }
  return null;
}

/**
 * The headline case.
 *
 * CLAUDE.md: "The two can disagree. The company document is usually updated
 * first. When they disagree, that is the headline of the case, not an error
 * state." So this is a first-class query, not an exception path.
 *
 * `indeterminate` on either side is not a disagreement — it is an absence of
 * an answer, and saying "these sources conflict" on the strength of a shrug
 * would be putting words in the document's mouth.
 */
export function sourcesDisagree(assessment: Assessment): boolean {
  const listed = standingListedness(assessment);
  const expected = standingExpectedness(assessment);
  if (listed === null || expected === null) return false;
  if (listed === "indeterminate" || expected === "indeterminate") return false;
  return (
    (listed === "listed" && expected === "unexpected") ||
    (listed === "unlisted" && expected === "expected")
  );
}

/**
 * Whether the expedited clock applies. Seriousness is the caller's to
 * establish — it lives on the reaction, not here — so it comes in as an
 * argument rather than being guessed at.
 *
 * Only `unlisted` starts the clock. `indeterminate` does not: an unresolved
 * question is a reason to hurry the review, not a reason to notify.
 */
export function requiresExpeditedReport(
  assessment: Assessment,
  reactionIsSerious: boolean,
): boolean {
  return reactionIsSerious && standingListedness(assessment) === "unlisted";
}

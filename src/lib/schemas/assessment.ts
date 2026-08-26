/**
 * Assessment — what the company document says, what the public FDA label
 * says, and the reviewer's ruling on the two.
 *
 * The shape here does most of the work of CLAUDE.md non-negotiables #3 and #4.
 * Rather than requiring every renderer to remember "no citation, no claim",
 * the finding is a discriminated union in which only the `grounded` variant
 * *has* passages at all, and that variant cannot be constructed with an empty
 * citation list. An uncited claim is not a value this module can produce —
 * there is no field to put it in.
 *
 * WHAT CHANGED WHEN GENERATION ARRIVED
 * A finding used to carry a `determination` — "listed" or "unlisted" — marked
 * `suggestedBy: "model"`. That field was read by `standingListedness`, which
 * fed the 15-day expedited clock. So a model-produced string started a
 * regulatory deadline with no human in the loop. It was invisible only because
 * the value was a hand-written fixture and no model had ever run.
 *
 * The determination now lives on `ReviewerRuling` and nowhere else. A finding
 * carries the retrieved passages and the model's *reading* of them; a reading
 * reports what a document says and has no field in which to say what follows
 * from it. The clock keys off the ruling, so it starts when a human rules.
 */
import { z } from "zod";
import {
  AssessmentId,
  CaseId,
  Citation,
  DrugId,
  IsoDateTime,
  ReactionId,
  ReviewerId,
} from "./primitives";
import { ModelReading } from "./reading";

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
 *
 * Generation adds a fourth possibility, but not a fourth state: retrieval can
 * succeed while the model fails. That case stays `grounded` — the passages are
 * real and must still be shown — and the failure is recorded on the reading.
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
 * A reading may only cite a passage that was retrieved alongside it.
 *
 * The generation step already rejects a chunk id it did not send, so this is
 * the second of two locks on the same door. It is worth having: this one holds
 * for any Assessment parsed from anywhere — a fixture, a stored row, a queue
 * message — not only for one that came straight out of the model call.
 *
 * Written as a statement body rather than an expression because narrowing does
 * not survive into the `some` callback, and `f.reading.chunkId` does not
 * typecheck without the local.
 */
function readingCitesRetrievedChunk(finding: {
  readonly citations: readonly { readonly chunkId: string }[];
  readonly reading: ModelReading;
}): boolean {
  const { reading } = finding;
  if (reading.status !== "read") return true;
  return finding.citations.some((c) => c.chunkId === reading.chunkId);
}

const CITED_CHUNK_RULE = {
  message: "A reading must cite one of the passages retrieved with it",
  path: ["reading", "chunkId"],
};

/**
 * A `grounded` finding is "we retrieved these passages, and here is the
 * model's reading of them". It is not a conclusion, and there is no field in
 * which it could become one.
 *
 * The citations come from retrieval, which is deterministic. The reading comes
 * from the model. Keeping them in separate fields means a model outage costs
 * the reading and not the evidence: the reviewer still gets the passages.
 */
export const ListednessFinding = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("grounded"),
      documentKind: GoverningDocumentKind,
      citations: z.array(Citation).min(1),
      reading: ModelReading,
      retrievedAt: IsoDateTime,
    })
    .refine((f) => f.citations.every((c) => c.sourceType === "company"), {
      message: "Listedness may only cite company documents",
      path: ["citations"],
    })
    .refine(readingCitesRetrievedChunk, CITED_CHUNK_RULE),
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
      citations: z.array(Citation).min(1),
      reading: ModelReading,
      /** openFDA SPL set id the label came from. */
      labelSetId: z.string().min(1).nullable(),
      retrievedAt: IsoDateTime,
    })
    .refine((f) => f.citations.every((c) => c.sourceType === "public"), {
      message: "Expectedness may only cite public labels",
      path: ["citations"],
    })
    .refine(readingCitesRetrievedChunk, CITED_CHUNK_RULE),
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
 * The human ruling. Nullable on the Assessment, and it is the ONLY place a
 * determination exists anywhere in this codebase — non-negotiable #4. The
 * model reads the documents; a reviewer rules, or nobody does.
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
 * The determination that stands, which is the reviewer's or nothing.
 *
 * Named `ruled` rather than `standing` because the old name promised more than
 * this returns: it used to fall back to the model's suggestion. It no longer
 * does, and a name that implies otherwise is a lie a caller would act on.
 *
 * Returns null rather than a default. "No reviewer has ruled" is a state the
 * UI must show rather than paper over, and it is emphatically not the same as
 * "indeterminate", which is a reviewer's considered shrug.
 */
export function ruledListedness(
  assessment: Assessment,
): ListednessDetermination | null {
  return assessment.ruling?.listedness ?? null;
}

export function ruledExpectedness(
  assessment: Assessment,
): ExpectednessDetermination | null {
  return assessment.ruling?.expectedness ?? null;
}

/**
 * What a document was observed to say, with no determination attached.
 *
 * This is the pre-ruling readout. It collapses "retrieval found nothing" and
 * "the model read the passages and none describes the reaction" into `silent`,
 * because to a reviewer scanning a queue they mean the same thing: this
 * document does not appear to mention it. They still render differently on the
 * case screen, where the difference is worth the space.
 *
 * `unknown` is kept strictly apart. An outage is not a silence.
 */
export type DocumentStance = "describes" | "silent" | "unknown";

export function documentStance(
  finding: ListednessFinding | ExpectednessFinding,
): DocumentStance {
  if (finding.state === "source_unavailable") return "unknown";
  if (finding.state === "no_result") return "silent";
  switch (finding.reading.status) {
    case "read":
      return "describes";
    case "nothing_found":
      return "silent";
    case "unavailable":
      return "unknown";
  }
}

/**
 * The headline case, before anybody has ruled.
 *
 * CLAUDE.md: "The two can disagree. The company document is usually updated
 * first. When they disagree, that is the headline of the case, not an error
 * state." That headline used to be computed from two model-suggested
 * determinations, which is the model deciding what the case is about.
 *
 * It is now computed from what the two documents were observed to say — one
 * describes the reaction, the other is silent on it. That is an observation
 * about two documents, not a judgement about a drug, and it needs no verdict
 * from anyone to be true.
 *
 * `unknown` on either side is not a divergence. Saying "these sources
 * conflict" on the strength of an outage would be putting words in a
 * document's mouth.
 */
export function readingsDiverge(assessment: Assessment): boolean {
  const company = documentStance(assessment.listedness);
  const label = documentStance(assessment.expectedness);
  if (company === "unknown" || label === "unknown") return false;
  return company !== label;
}

/**
 * The headline case, after a reviewer has ruled on both sides.
 *
 * `indeterminate` on either side is not a disagreement — it is an absence of
 * an answer, and saying "these sources conflict" on the strength of a shrug
 * would be overstating what the reviewer actually decided.
 */
export function sourcesDisagree(assessment: Assessment): boolean {
  const listed = ruledListedness(assessment);
  const expected = ruledExpectedness(assessment);
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
 * Only a reviewer's `unlisted` starts the clock. Nothing the model produces
 * can, which is the whole of the change that came in with generation.
 * `indeterminate` does not either: an unresolved question is a reason to hurry
 * the review, not a reason to notify.
 */
export function requiresExpeditedReport(
  assessment: Assessment,
  reactionIsSerious: boolean,
): boolean {
  return reactionIsSerious && ruledListedness(assessment) === "unlisted";
}

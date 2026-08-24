/**
 * SuspectDrug — the third minimum validity criterion.
 *
 * Also the field that decides which company document the listedness question
 * gets asked against: a marketed drug is judged against its CCDS, an
 * investigational one against its Investigator's Brochure.
 */
import { z } from "zod";
import { DrugId, NarrativeSpan, Provenance } from "./primitives";
import { PartialDate } from "./partial-date";

/**
 * Only `suspect` drugs drive listedness. Concomitant medicines are recorded
 * because they matter to causality, but they are not what the case is about.
 */
export const DrugRole = z.enum(["suspect", "concomitant", "interacting"]);
export type DrugRole = z.output<typeof DrugRole>;

/**
 * Which core safety document governs this product. This is the fork described
 * in CLAUDE.md under Listedness, encoded once so no screen has to re-derive it.
 */
export const MarketingStatus = z.enum(["marketed", "investigational"]);
export type MarketingStatus = z.output<typeof MarketingStatus>;

export const RouteOfAdministration = z.enum([
  "oral",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "topical",
  "inhalation",
  "other",
  "unknown",
]);
export type RouteOfAdministration = z.output<typeof RouteOfAdministration>;

/**
 * Dechallenge and rechallenge outcomes. `not_done` and `unknown` are different
 * facts and are kept apart: "the drug was never stopped" is evidence, whereas
 * "we do not know whether it was stopped" is an information gap the reviewer
 * may need to chase.
 */
export const ChallengeOutcome = z.enum([
  "positive", // stopping helped / restarting brought it back
  "negative", // stopping did not help / restarting did not reproduce it
  "not_done",
  "unknown",
  "not_applicable",
]);
export type ChallengeOutcome = z.output<typeof ChallengeOutcome>;

/**
 * A dechallenge or rechallenge reading.
 *
 * CLAUDE.md is explicit that this is "suggested by the model, never concluded
 * by it", so the outcome never stands alone. It travels with who proposed it,
 * whether a human has signed it off, and the words in the narrative it was
 * read from. A screen showing this without showing `suggestedBy` would be
 * misrepresenting a suggestion as a finding.
 */
export const ChallengeAssessment = z.object({
  outcome: ChallengeOutcome,
  suggestedBy: Provenance,
  confirmedByReviewer: z.boolean(),
  rejectedByReviewer: z.boolean(),
  /** The phrase this was read from. Null only when a reviewer asserted it directly. */
  evidence: NarrativeSpan.nullable(),
});
export type ChallengeAssessment = z.output<typeof ChallengeAssessment>;

export const SuspectDrug = z.object({
  id: DrugId,
  /** Exactly as the reporter wrote it. Preserved verbatim for the audit trail. */
  reportedName: z.string().min(1).max(200),
  /** Normalised active substance, once someone has mapped it. */
  activeSubstance: z.string().min(1).max(200).nullable(),
  role: DrugRole,
  marketingStatus: MarketingStatus,
  dose: z.string().min(1).max(120).nullable(),
  route: RouteOfAdministration.nullable(),
  /** Why it was being taken — relevant to whether the event is the disease. */
  indication: z.string().min(1).max(200).nullable(),
  // Partial for the same reason as Reaction.onset: people remember months.
  therapyStart: PartialDate.nullable(),
  therapyEnd: PartialDate.nullable(),
  dechallenge: ChallengeAssessment.nullable(),
  rechallenge: ChallengeAssessment.nullable(),
});
export type SuspectDrug = z.output<typeof SuspectDrug>;

/**
 * The drugs that actually put the case on the queue. Criterion three is about
 * a *suspect* drug specifically — a case listing only concomitant medicines
 * has not identified anything to assess.
 */
export function suspectDrugsOf(
  drugs: readonly SuspectDrug[],
): readonly SuspectDrug[] {
  return drugs.filter((d) => d.role === "suspect");
}

/**
 * Which company document this drug is judged against. One line, but it is the
 * line that decides whether the reviewer is reading a CCDS or an IB.
 */
export function governingDocumentKind(
  drug: SuspectDrug,
): "ccds" | "investigators_brochure" {
  return drug.marketingStatus === "marketed" ? "ccds" : "investigators_brochure";
}

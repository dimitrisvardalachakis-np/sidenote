/**
 * What the library holds for a given medicine.
 *
 * The two directions of the same missing link. A reviewer could not ask "do we
 * even hold a CCDS for Pulmoxa?", so a case for a drug with no company
 * document looked exactly like a case for a drug with one — right up until the
 * search returned nothing and "no matching passage" was read as a fact about
 * the document rather than about the shelf. And after uploading a document,
 * nothing said which queued cases it now affected.
 *
 * Both are one-line answers the data already supported. This is the line.
 *
 * `documentGovernsDrug` from `assess/scope.ts` is the SAME predicate retrieval
 * uses, deliberately: if coverage said a document was held and retrieval
 * disagreed about which drug it governs, the screen would be reassuring a
 * reviewer about a document the search would never reach.
 */
import { documentGovernsDrug, type DrugIdentity } from "@/lib/assess/scope";
import type { SafetyDocument } from "@/lib/schemas";

export interface DrugCoverage {
  readonly drug: DrugIdentity;
  /** The company's own safety document — CCDS or Investigator's Brochure. */
  readonly company: readonly SafetyDocument[];
  /** The public FDA label. */
  readonly publicLabel: readonly SafetyDocument[];
}

export function coverageFor(
  documents: readonly SafetyDocument[],
  drug: DrugIdentity,
): DrugCoverage {
  const governing = documents.filter((doc) => documentGovernsDrug(doc, drug));
  return {
    drug,
    company: governing.filter((doc) => doc.sourceType === "company"),
    publicLabel: governing.filter((doc) => doc.sourceType === "public"),
  };
}

/**
 * Coverage for every medicine the library knows about, by active substance.
 *
 * Grouped on the substance rather than the brand name because that is what
 * routes retrieval — two brands of the same molecule share a CCDS, and listing
 * them separately would report a gap that is not there.
 */
export function coverageBySubstance(
  documents: readonly SafetyDocument[],
): readonly DrugCoverage[] {
  const substances = [
    ...new Set(documents.map((doc) => doc.activeSubstance.toLowerCase())),
  ].sort();

  return substances.map((substance) =>
    coverageFor(documents, { reportedName: substance, activeSubstance: substance }),
  );
}

/** Neither half held. The case where a search cannot succeed. */
export function isUncovered(coverage: DrugCoverage): boolean {
  return coverage.company.length === 0 && coverage.publicLabel.length === 0;
}

/**
 * What a newly ingested document changes, in a sentence.
 *
 * Uploading used to have no visible consequence anywhere in a reviewer's work.
 * This is the smallest thing that gives it one — and it deliberately says
 * "can now be re-assessed" rather than "will be": nothing re-runs on its own,
 * and implying it did would leave a reviewer waiting for an assessment that is
 * never coming.
 */
export function affectedCaseCount(
  cases: readonly { readonly drugs: readonly DrugIdentity[] }[],
  document: SafetyDocument,
): number {
  return cases.filter((record) =>
    record.drugs.some((drug) => documentGovernsDrug(document, drug)),
  ).length;
}

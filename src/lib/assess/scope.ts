/**
 * Which documents belong to this case's product.
 *
 * Retrieval used to be filtered by `sourceType` alone. The drug name went into
 * the BM25 query as another term, which is a preference, not a filter — so a
 * Covaxil case reporting jaundice pulled the *Hepalex* Core Data Sheet into
 * the citable set, because that is where the word "jaundice" lives. The model
 * would then quote it correctly and verbatim, pass every check in verify.ts,
 * and the reviewer would read another product's confidential safety document
 * presented as this drug's listedness evidence. Nothing misbehaved; the search
 * was simply asked the wrong question.
 *
 * So the corpus is narrowed before the search rather than ranked after it.
 * Scoping is a filter because a wrong-product citation is not a worse hit, it
 * is a different document.
 *
 * A real system resolves brand to substance through a product dictionary. This
 * has fixtures and uploads, so it matches on the substance when the case
 * records one and falls back to the document title otherwise. When nothing
 * matches, the answer is "no document is held for this product" — which is a
 * `source_unavailable`, not a silence.
 */
import type { DocumentId, SafetyDocument } from "@/lib/schemas";

/**
 * The two fields scoping is computed from, and nothing else.
 *
 * Structural rather than `SuspectDrug`, for the reason `ValidityInput` is
 * structural in case.ts: the public intake needs to scope retrieval before a
 * SuspectDrug exists — there is no id, no role, no marketing status yet, only
 * a name the reporter typed. A SuspectDrug satisfies this automatically.
 */
export interface DrugIdentity {
  readonly reportedName: string;
  readonly activeSubstance: string | null;
}

/** Case-insensitive, punctuation-tolerant comparison of product wording. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * True when a document governs this drug.
 *
 * Substance match first, because it is the reliable one: a CCDS is written
 * about a substance and a case that has been triaged carries it. The title
 * fallback exists for a public report, where a member of the public knows the
 * name on the box and nothing else.
 *
 * The fallback is a prefix test rather than a substring one — "hepalexin"
 * starts with "hepalex" — because brand names are commonly the stem of the
 * substance. It is a heuristic and it is allowed to miss: missing means the
 * panel says no document is held, which sends a reviewer to look. The failure
 * that is not allowed is matching the wrong product.
 */
export function documentGovernsDrug(
  document: SafetyDocument,
  drug: DrugIdentity,
): boolean {
  const substance = normalise(document.activeSubstance);

  if (drug.activeSubstance !== null) {
    return substance === normalise(drug.activeSubstance);
  }

  const reported = normalise(drug.reportedName);
  if (reported.length < 3) return false;

  return (
    substance === reported ||
    substance.startsWith(reported) ||
    normalise(document.title).split(" ").includes(reported)
  );
}

/**
 * The document ids retrieval is allowed to reach for this case.
 *
 * Returned as a Set because the caller uses it to filter every chunk in the
 * corpus, and a linear scan per chunk over a growing library is the kind of
 * thing that is fine in a fixture and not fine in a year.
 */
export function documentsForDrug(
  documents: readonly SafetyDocument[],
  drug: DrugIdentity,
): ReadonlySet<DocumentId> {
  return new Set(
    documents
      .filter((document) => documentGovernsDrug(document, drug))
      .map((document) => document.id),
  );
}

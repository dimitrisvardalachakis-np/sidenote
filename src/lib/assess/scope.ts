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
 * Words that name a salt, ester or hydrate rather than a different substance.
 *
 * A CLOSED LIST, AND DELIBERATELY SO. FDA publishes the salt form —
 * "abacavir sulfate", "atorvastatin calcium", "metoprolol succinate" — while a
 * reporter, a CCDS and this project's own fixtures name the active moiety. The
 * salt is a formulation detail; the two are the same medicine, and treating
 * them as different products is what made a fetched label unsearchable by the
 * very name it was fetched under.
 *
 * The alternative was a rule like "ignore any trailing word", and that rule is
 * wrong: "amoxicillin clavulanate" and "insulin glargine" are NOT their first
 * word, and matching them to a plain amoxicillin or insulin label would be
 * exactly the wrong-product citation this file exists to prevent. Naming the
 * salts explicitly draws the line where the chemistry draws it, and anything
 * not on the list fails closed — the old behaviour, unchanged.
 */
const SALT_AND_HYDRATE_WORDS: ReadonlySet<string> = new Set([
  "acetate", "anhydrous", "benzoate", "besylate", "bitartrate", "bromide",
  "calcium", "carbonate", "chloride", "citrate", "dihydrate", "disodium",
  "fumarate", "gluconate", "hcl", "hemihydrate", "hydrate", "hydrobromide",
  "hydrochloride", "lactate", "magnesium", "maleate", "malate", "mesilate",
  "mesylate", "monohydrate", "nitrate", "phosphate", "potassium", "propionate",
  "salt", "sodium", "succinate", "sulfate", "sulphate", "tartrate",
  "trihydrate", "valerate",
]);

/**
 * The active moiety of a substance name: "abacavir sulfate" → "abacavir".
 *
 * Applied to BOTH sides of every comparison, so the match is symmetric — a
 * case recording "abacavir" finds a label filed under "abacavir sulfate" and
 * the reverse holds too. At least one word always survives, so a name that is
 * nothing but a salt word is left alone rather than reduced to nothing.
 */
export function activeMoiety(substance: string): string {
  const words = normalise(substance).split(" ").filter((w) => w.length > 0);
  let end = words.length;
  while (end > 1) {
    const last = words[end - 1];
    if (last === undefined || !SALT_AND_HYDRATE_WORDS.has(last)) break;
    end -= 1;
  }
  return words.slice(0, end).join(" ");
}

/**
 * True when `words` occurs in `text` as a whole-word sequence.
 *
 * This replaced a `split(" ").includes(...)` test, which could only ever match
 * a single word: a reporter typing "abacavir sulfate" was compared against the
 * title's individual words and never matched one, so a multi-word name could
 * not reach a document through the title at all. Padding both sides keeps the
 * whole-word behaviour that made the original safe — "hepalex" still does not
 * match "hepalexin" here — while letting a phrase match a phrase.
 */
function containsWords(text: string, words: string): boolean {
  return ` ${text} `.includes(` ${words} `);
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
 *
 * Every comparison runs on the active moiety rather than the raw name, because
 * FDA files a label under its salt. Without that, naming "ABACAVIR SULFATE" on
 * the public search fetched the abacavir label from openFDA and then excluded
 * it from the search it had just been fetched for — the reporter was told
 * "Fetched Abacavir — FDA Prescribing Information" and, directly beneath it,
 * "No published label we hold describes that". Both sentences were produced by
 * this predicate disagreeing with itself, and the second one is a false
 * statement about a safety document.
 */
export function documentGovernsDrug(
  document: SafetyDocument,
  drug: DrugIdentity,
): boolean {
  const substance = activeMoiety(document.activeSubstance);

  if (drug.activeSubstance !== null) {
    return substance === activeMoiety(drug.activeSubstance);
  }

  const reported = activeMoiety(drug.reportedName);
  if (reported.length < 3) return false;

  return (
    substance === reported ||
    substance.startsWith(reported) ||
    containsWords(normalise(document.title), reported)
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

/**
 * Resolving what a reviewer types into the jump box to a case.
 *
 * A colleague says "look at SN-2026-000104" over a call. Sometimes they say
 * "one-oh-four". Both have to work, and neither may guess.
 *
 * Pure, and separated from the route that uses it, because the interesting
 * behaviour here is not the redirect — it is what happens when the input is
 * ambiguous. Two years of cases can both carry ordinal 104, and picking the
 * newer one would send a reviewer to a case that is not the one their
 * colleague is reading from. An ambiguous input resolves to nothing and says
 * so. Guessing is the failure mode this function exists to refuse.
 */

export interface CaseReferenceCandidate {
  readonly id: string;
  readonly reference: string;
}

export type ReferenceLookup =
  | { readonly kind: "found"; readonly caseId: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "ambiguous"; readonly matches: readonly string[] };

/** Trailing run of digits, which is the ordinal a person says out loud. */
function ordinalOf(reference: string): string | null {
  const digits = /(\d+)\s*$/.exec(reference);
  // Leading zeros stripped so "000104", "0104" and "104" are one value.
  return digits?.[1]?.replace(/^0+(?=\d)/, "") ?? null;
}

function normalise(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Three ways to name a case, tried in order of how specific they are.
 *
 * The order matters: an exact reference always wins, so a reviewer who typed
 * the whole thing can never be told it was ambiguous because some other year
 * shares its ordinal.
 */
export function lookupCaseReference(
  input: string,
  known: readonly CaseReferenceCandidate[],
): ReferenceLookup {
  const query = normalise(input);
  if (query.length === 0) return { kind: "not_found" };

  const exact = known.filter((c) => normalise(c.reference) === query);
  if (exact.length === 1 && exact[0] !== undefined) {
    return { kind: "found", caseId: exact[0].id };
  }

  // Digits only: match on the ordinal, ignoring zero padding.
  if (/^\d+$/.test(query)) {
    const wanted = query.replace(/^0+(?=\d)/, "");
    const byOrdinal = known.filter((c) => ordinalOf(c.reference) === wanted);
    return resolve(byOrdinal);
  }

  // Anything else is treated as a prefix, so a half-typed reference still
  // lands when it can only mean one case.
  const byPrefix = known.filter((c) => normalise(c.reference).startsWith(query));
  return resolve(byPrefix);
}

function resolve(matches: readonly CaseReferenceCandidate[]): ReferenceLookup {
  const first = matches[0];
  if (first === undefined) return { kind: "not_found" };
  if (matches.length > 1) {
    return { kind: "ambiguous", matches: matches.map((m) => m.reference) };
  }
  return { kind: "found", caseId: first.id };
}

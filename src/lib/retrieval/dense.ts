/**
 * The dense ranking: a question in, a list of scored chunks out.
 *
 * This is the second half of hybrid retrieval, shaped to drop straight into
 * `fuseByRank` alongside the lexical ranking. It produces `ScoredChunk[]` with
 * the same `${documentId}#${ordinal}` ids the chunker mints, deduped and
 * ordered, because that is what fusion requires to treat the two rankings as
 * views of one corpus rather than two.
 *
 * WHAT THIS FILE IS REALLY FOR
 *
 * A vector store can outlive an edit. A document is re-uploaded and re-chunked;
 * a metadata filter is missing because its index was never created; a stale id
 * survives a delete that never happened. In every one of those cases the store
 * hands back an id that should not be cited, and it is this file's job to
 * refuse it — not the store's, and not a remote service's filter.
 *
 * So every match is hydrated from the corpus the caller already holds, using
 * the same two predicates `inScope` applies in assess.ts. A match the mirror
 * does not confirm is dropped silently. The store contributes an id and a
 * rank; the text, the citation and the scope all come from the mirror.
 *
 * Nothing here throws. A dense half that fails is retrieval behaving exactly
 * as it did before this feature existed, which is a degradation and not an
 * error — but the caller is told, so the difference between "searched and
 * found nothing" and "could not search" survives onto the audit line.
 */
import type { DocumentChunk, DocumentId, SourceType } from "@/lib/schemas";
import { expandQuery, tokenise, type ScoredChunk } from "./search";
import {
  DENSE_MIN_COSINE,
  DENSE_OVERFETCH,
  VECTORIZE_MAX_TOPK,
} from "./thresholds";
import type { DenseAvailability, Vector } from "./vectors";

export interface DenseSearchInput {
  readonly dense: DenseAvailability;
  /** The corpus. Both the hydration source and half the scope guarantee. */
  readonly chunks: readonly DocumentChunk[];
  readonly query: string;
  readonly sourceType: SourceType;
  readonly documentIds: ReadonlySet<DocumentId>;
  readonly limit: number;
  readonly minScore?: number | undefined;
  /** Precomputed, so one embedding can serve both namespaces of one case. */
  readonly queryVector?: Vector | null | undefined;
  readonly activeSubstances?: readonly string[] | undefined;
}

export interface DenseOutcome {
  readonly hits: readonly ScoredChunk[];
  /**
   * Null when the dense half actually ran.
   *
   * An outcome rather than a bare array, because "dense ran and matched
   * nothing" and "dense could not run" are different facts and collapsing them
   * is the same mistake, one layer down, that non-negotiable #5 is about.
   */
  readonly unavailableReason: string | null;
}

/** Query terms that genuinely occur in this chunk. */
function matchedTermsIn(
  chunk: DocumentChunk,
  terms: readonly string[],
): readonly string[] {
  const present = new Set(tokenise(chunk.text));
  return terms.filter((term) => present.has(term));
}

export async function denseSearch(
  input: DenseSearchInput,
): Promise<DenseOutcome> {
  const { dense, chunks, query, sourceType, documentIds, limit } = input;

  if (dense.embedder === null || dense.store === null) {
    return {
      hits: [],
      unavailableReason: dense.reason ?? "no vector store is configured",
    };
  }
  if (query.trim().length === 0) {
    return { hits: [], unavailableReason: null };
  }

  /*
    The hydration index, built with the SAME predicate inScope() uses.

    A chunk that is not in scope is never put in this map, so it can never be
    hydrated, so it can never be cited — whatever the store returned and
    whatever its filter did or did not do. This is where the wrong-product
    guarantee actually lives; the remote filter is only an optimisation that
    reduces how much gets over-fetched.
  */
  const byId = new Map<string, DocumentChunk>();
  for (const chunk of chunks) {
    if (chunk.sourceType === sourceType && documentIds.has(chunk.documentId)) {
      byId.set(chunk.id, chunk);
    }
  }
  if (byId.size === 0) return { hits: [], unavailableReason: null };

  let matches;
  try {
    const vector =
      input.queryVector ?? (await dense.embedder.embed([query]))[0];
    if (vector === undefined) {
      return { hits: [], unavailableReason: "the query could not be embedded" };
    }

    matches = await dense.store.query({
      vector,
      topK: Math.min(VECTORIZE_MAX_TOPK, Math.max(limit, limit * DENSE_OVERFETCH)),
      sourceType,
      documentIds,
      activeSubstances: input.activeSubstances,
    });
  } catch (cause) {
    // Never rethrown. A dense failure leaves retrieval exactly as it was
    // before this feature existed, and the caller reports why.
    return {
      hits: [],
      unavailableReason:
        cause instanceof Error
          ? cause.message
          : "the vector store could not be reached",
    };
  }

  const floor = input.minScore ?? DENSE_MIN_COSINE;
  const terms = expandQuery(query);
  const seen = new Set<string>();
  const hits: ScoredChunk[] = [];

  for (const match of matches) {
    if (match.score < floor) continue;
    // A duplicate would contribute twice in RRF and double-weight one passage.
    if (seen.has(match.id)) continue;
    seen.add(match.id);

    const chunk = byId.get(match.id);
    // THE LINE THIS FILE EXISTS FOR. A vector whose chunk the mirror does not
    // confirm — stale, re-chunked, leaked from another product — is discarded
    // rather than cited.
    if (chunk === undefined) continue;

    hits.push({
      chunk,
      score: match.score,
      /*
        The query terms that really occur, and no others.

        toCitation renders an excerpt centred on matched[0], so an empty list
        centres on the chunk's opening — usually a section heading rather than
        the sentence that mattered. Synthesising a term that does NOT occur
        would be worse: the field is named `matched`, is rendered as an
        explanation of the hit, and is unioned into the fused hit's own
        `matched`. For a genuinely semantic match this is legitimately empty,
        and the model picks the sentence downstream anyway.
      */
      matched: matchedTermsIn(chunk, terms),
    });
  }

  return {
    hits: hits
      .sort((a, b) =>
        b.score === a.score
          ? a.chunk.id.localeCompare(b.chunk.id)
          : b.score - a.score,
      )
      .slice(0, limit),
    unavailableReason: null,
  };
}

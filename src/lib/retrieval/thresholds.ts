/**
 * What a BM25 score has to clear to count as a match.
 *
 * A separate file from search.ts, which stays exactly as it was — this is a
 * decision about how callers use the ranker, not a change to the ranker.
 *
 * The number is deliberately just above zero, and the reasoning is the part
 * worth keeping. A BM25 threshold is a property of the corpus it was tuned on:
 * idf falls as the corpus shrinks, so the same genuine hit that scores 1.91
 * across every company document scores 0.91 within one product's two, and
 * 0.29 in a three-chunk test fixture. Any absolute floor picked against a
 * large corpus silently deletes real hits from a small one — and both callers
 * now search a corpus scoped to a single product, which is as small as it
 * gets.
 *
 * So the floor means only "at least one query term matched", which is exactly
 * what a score above zero means once the query carries no filler. Relevance to
 * the product is the scope's job; which passage actually describes the
 * reaction is decided downstream — by the model on the reviewer path, and by
 * the reporter reading the quoted passage on the public one.
 */
export const MATCHED_ANY_TERM = 0.01;

/**
 * What a cosine similarity has to clear to count as a semantic match.
 *
 * Cosine ranges -1..1 in principle. In practice sentence embeddings from one
 * model do not use that range: bge-base-en-v1.5 puts unrelated English prose
 * somewhere around 0.35–0.60 and genuinely related prose around 0.60–0.90. So
 * the naive reading of the range — "above zero means related" — admits
 * everything, which would feed pure noise into RRF at full weight.
 *
 * 0.55 sits just inside that overlap: low enough to keep the paraphrase this
 * whole feature exists for, high enough to drop a cover page that scope alone
 * leaves in the candidate set.
 *
 * HOW THIS DIFFERS FROM MATCHED_ANY_TERM, and why the difference cuts the
 * other way. BM25's idf shifts with corpus size, which is why an absolute
 * lexical floor tuned on a big corpus deletes real hits from a small one.
 * Cosine does not — it is a property of two vectors and nothing else — so a
 * fixed floor is MORE defensible here, not less. What it IS a property of is
 * the model. Change EMBEDDING_MODEL and this number must be re-derived rather
 * than carried over.
 *
 * It is a starting value from the model's typical distribution, not a
 * measurement on this corpus. Earning a better one needs a labelled
 * query-to-chunk set, which does not exist yet.
 */
export const DENSE_MIN_COSINE = 0.55;

/**
 * How deep the dense ranking goes.
 *
 * The same depth as the lexical ranking, deliberately. RRF weights by rank, so
 * a deeper ranking gets more chances to contribute and would quietly outweigh
 * the shallower one for no reason anybody chose.
 */
export const DENSE_LIMIT = 5;

/**
 * How much to over-fetch before the scope post-filter runs.
 *
 * `denseSearch` discards any match whose chunk is not in scope, so asking for
 * exactly the depth wanted can starve when the index holds other products.
 */
export const DENSE_OVERFETCH = 4;

/** Vectorize caps topK at 50 when metadata comes back with the matches. */
export const VECTORIZE_MAX_TOPK = 50;

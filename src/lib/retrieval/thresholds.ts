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

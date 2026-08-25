import "server-only";
import { inArray } from "drizzle-orm";
import { embed } from "@/lib/ai/embeddings";
import { queryVectors } from "@/lib/ai/vectorize";
import { getDb, schema } from "@/lib/db/client";
import { rowToChunk } from "@/lib/db/mappers";
import { SEED_CHUNKS } from "@/lib/fixtures/documents";
import { loadCorpus } from "@/lib/store/corpus";
import type { SourceType } from "@/lib/schemas";
import { lexicalSearchD1 } from "./lexical-d1";
import { fuseByRank, lexicalSearch, type ScoredChunk } from "./search";

/**
 * Hybrid retrieval, as CLAUDE.md specifies it.
 *
 * Two rankings go in — dense from Vectorize, lexical from D1 FTS5 — and
 * Reciprocal Rank Fusion combines them. RRF rather than averaging the scores,
 * because a BM25 rank and a cosine similarity are not on comparable scales and
 * averaging them silently hands the result to whichever produces bigger
 * numbers.
 *
 * EACH HALF REPORTS WHETHER IT RAN.
 *
 * This is the same distinction the assessment schema already draws between
 * `no_result` and `source_unavailable`, and it matters more here than anywhere:
 * "the dense search found nothing" and "the dense search did not happen" look
 * identical in a result list and mean opposite things to a reviewer deciding
 * whether a reaction is described in a document. So the caller gets both the
 * hits and an honest account of which halves produced them.
 *
 * Retrieval never fails outright. If Vectorize is unbound the lexical half
 * still answers, which is worse retrieval and not an outage — non-negotiable
 * #5, an AI failure must never block a human.
 */

export type HalfState =
  | { readonly ran: true; readonly hits: number }
  | { readonly ran: false; readonly reason: string };

export interface HybridResult {
  readonly hits: readonly ScoredChunk[];
  readonly dense: HalfState;
  readonly lexical: HalfState;
  /**
   * True when a half did not run.
   *
   * Recorded on the `assess_case` audit line, and NOT yet shown on the evidence
   * panels — Assessment has no field for it, and inventing one would mean a
   * schema change that Cluster E did not need. Worth knowing when reading a log
   * that says "grounded": the finding is real and its citations are real, but
   * it was reached by one retrieval strategy rather than two.
   */
  readonly degraded: boolean;
}

/**
 * Ask for more from each half than the caller wants back.
 *
 * RRF rewards a passage that both halves rank, so the fusion needs enough depth
 * to notice the agreement. Fusing two top-5 lists mostly reproduces whichever
 * list was longer.
 */
const CANDIDATES_PER_HALF = 20;

export async function hybridSearch(
  query: string,
  sourceType: SourceType,
  limit = 5,
): Promise<HybridResult> {
  const db = await getDb();

  const [lexical, dense, seeded] = await Promise.all([
    lexicalHalf(db, query, sourceType),
    denseHalf(db, query, sourceType),
    seededHalf(db, query, sourceType),
  ]);

  const rankings = [lexical.hits, dense.hits, seeded].filter(
    (ranking) => ranking.length > 0,
  );

  return {
    hits: fuseByRank(rankings).slice(0, limit),
    dense: dense.state,
    lexical: lexical.state,
    degraded: !dense.state.ran || !lexical.state.ran,
  };
}

interface Half {
  readonly hits: readonly ScoredChunk[];
  readonly state: HalfState;
}

/**
 * The seeded demo corpus, searched in memory.
 *
 * A third ranking, and it exists because the fixtures are not real documents:
 * nobody uploaded them, so they never went through the ingestion pipeline, so
 * they have no rows in `chunks`, no FTS5 entries and no vectors. With D1 bound
 * they would simply disappear from every search — the demo would go quiet the
 * moment the database was wired up, which is the opposite of what wiring up a
 * database should do.
 *
 * Fused rather than concatenated, like every other ranking. Skipped entirely
 * when there is no D1, because `lexicalHalf` is already searching the merged
 * corpus in that case and counting the same passage twice would let a fixture
 * outrank a real document by being fused with itself.
 */
async function seededHalf(
  db: Awaited<ReturnType<typeof getDb>>,
  query: string,
  sourceType: SourceType,
): Promise<readonly ScoredChunk[]> {
  if (db === null) return [];
  return lexicalSearch(SEED_CHUNKS, query, {
    limit: CANDIDATES_PER_HALF,
    sourceType,
  });
}

async function lexicalHalf(
  db: Awaited<ReturnType<typeof getDb>>,
  query: string,
  sourceType: SourceType,
): Promise<Half> {
  try {
    if (db !== null) {
      const hits = await lexicalSearchD1(
        db,
        query,
        sourceType,
        CANDIDATES_PER_HALF,
      );
      return { hits, state: { ran: true, hits: hits.length } };
    }

    // No D1: the in-memory BM25 over the seeded corpus. Genuinely equivalent
    // for a demo-sized corpus, and the reason the app works on a laptop with
    // nothing bound.
    const { chunks } = await loadCorpus();
    const hits = lexicalSearch(chunks, query, {
      limit: CANDIDATES_PER_HALF,
      sourceType,
    });
    return { hits, state: { ran: true, hits: hits.length } };
  } catch (error) {
    return {
      hits: [],
      state: {
        ran: false,
        reason: error instanceof Error ? error.name : "lexical_failed",
      },
    };
  }
}

async function denseHalf(
  db: Awaited<ReturnType<typeof getDb>>,
  query: string,
  sourceType: SourceType,
): Promise<Half> {
  // Embedding first: without a vector there is nothing to ask Vectorize, and
  // the reason the reviewer sees should name the step that actually failed.
  const embedded = await embed([query]);
  if (!embedded.ok) {
    return { hits: [], state: { ran: false, reason: embedded.reason } };
  }
  const vector = embedded.vectors[0];
  if (vector === undefined) {
    return { hits: [], state: { ran: false, reason: "empty_embedding" } };
  }

  const matches = await queryVectors(vector, sourceType, CANDIDATES_PER_HALF);
  if (!matches.ok) {
    return { hits: [], state: { ran: false, reason: matches.reason } };
  }

  if (db === null) {
    // Vectorize returns ids and scores; the text lives in D1 (pipeline step 7,
    // "so a citation can be rendered without a second vector call"). With no
    // D1 there is nothing to render, so this half honestly did not run.
    return { hits: [], state: { ran: false, reason: "no_database_for_text" } };
  }

  const ids = matches.value.map((match) => match.id);
  if (ids.length === 0) return { hits: [], state: { ran: true, hits: 0 } };

  const rows = await db
    .select()
    .from(schema.chunks)
    .where(inArray(schema.chunks.id, ids));

  const byId = new Map(rows.map((row) => [row.id, row]));

  const hits: ScoredChunk[] = [];
  for (const match of matches.value) {
    const row = byId.get(match.id);
    if (row === undefined) continue;

    // Belt and braces on the boundary. Vectorize was asked for one namespace,
    // but the namespace is the confidentiality boundary and a filter that is
    // enforced in exactly one place is a filter that is one refactor from being
    // enforced nowhere.
    if (row.sourceType !== sourceType) continue;

    try {
      hits.push({ chunk: rowToChunk(row), score: match.score, matched: [] });
    } catch {
      continue;
    }
  }

  return { hits, state: { ran: true, hits: hits.length } };
}

import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rowToChunk } from "@/lib/db/mappers";
import type { SourceType } from "@/lib/schemas";
import { expandQuery, type ScoredChunk } from "./search";

/**
 * The lexical half of hybrid retrieval, in D1's FTS5 index.
 *
 * CLAUDE.md: "Retrieval is hybrid: Vectorize dense results fused with D1 FTS5
 * lexical results via Reciprocal Rank Fusion. Vectorize is dense-only; FTS5
 * supplies the other half."
 *
 * Dense and lexical fail in opposite directions, which is why both are wanted.
 * A vector search for "rash on both hands" cheerfully returns a passage about
 * pruritus and misses one that says "erythema" three times. In a safety
 * document the exact word often IS the answer: a reviewer looking for
 * "Stevens-Johnson" wants the passage containing those words, not its nearest
 * neighbour in embedding space.
 */

/**
 * FTS5's query language is a query language, and the reviewer's text is not
 * written in it.
 *
 * An unescaped double quote or a bare `*` is a syntax error; `NOT` and `OR` are
 * operators; a hyphen starts a column filter. None of that is hypothetical in
 * this domain — "Stevens-Johnson" contains a hyphen and reviewers type it
 * constantly, and a query for `drug-induced NOT hepatic` would silently mean
 * something nobody asked for.
 *
 * So the text never reaches FTS5 as syntax. It is tokenised by the same
 * function the in-memory search uses — which also brings the synonym expansion,
 * so "rash" still finds "erythema" — and each token is re-quoted as a literal.
 * Doubling any internal quote is what makes the literal safe.
 */
export function toMatchExpression(query: string): string | null {
  const terms = expandQuery(query)
    .map((term) => term.replaceAll('"', '""'))
    .filter((term) => term.length > 0);

  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(" OR ");
}

interface FtsRow {
  readonly id: string;
  readonly documentId: string;
  readonly sourceType: string;
  readonly section: string | null;
  readonly ordinal: number;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly tokenEstimate: number;
  readonly rank: number;
}

export async function lexicalSearchD1(
  db: Db,
  query: string,
  sourceType: SourceType,
  limit: number,
): Promise<readonly ScoredChunk[]> {
  const match = toMatchExpression(query);
  if (match === null) return [];

  const terms = expandQuery(query);

  /**
   * `source_type` is filtered in SQL, not after.
   *
   * Filtering in application code would mean the database returned company
   * passages to a request that was not entitled to them, and the only thing
   * standing between that and a disclosure is a `.filter()` somebody remembers
   * to write. It also breaks `limit`: taking the top 20 and then discarding the
   * company ones leaves however many happen to be left.
   */
  const rows = await db.all<FtsRow>(sql`
    SELECT
      c.id            AS id,
      c.document_id   AS documentId,
      c.source_type   AS sourceType,
      c.section       AS section,
      c.ordinal       AS ordinal,
      c.text          AS text,
      c.char_start    AS charStart,
      c.char_end      AS charEnd,
      c.token_estimate AS tokenEstimate,
      bm25(chunks_fts) AS rank
    FROM chunks_fts
    JOIN chunks c ON c.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ${match}
      AND c.source_type = ${sourceType}
    ORDER BY rank
    LIMIT ${limit}
  `);

  return rows.flatMap((row) => {
    try {
      return [
        {
          chunk: rowToChunk({
            id: row.id,
            documentId: row.documentId,
            sourceType: row.sourceType,
            section: row.section,
            ordinal: row.ordinal,
            text: row.text,
            charStart: row.charStart,
            charEnd: row.charEnd,
            tokenEstimate: row.tokenEstimate,
            embeddedAt: null,
            // Neither is read by rowToChunk — DocumentChunk is the domain
            // shape and these two are storage bookkeeping. Supplied so the row
            // type is satisfied without widening the mapper's input.
            textHash: "",
          }),
          // bm25() is negative and lower is better. Flipped so the sign matches
          // every other score in this codebase; the magnitude is never compared
          // against a cosine similarity — that is what RRF is for.
          score: -row.rank,
          matched: terms.filter((term) =>
            row.text.toLowerCase().includes(term),
          ),
        },
      ];
    } catch {
      // A chunk row that no longer parses is skipped rather than allowed to
      // empty the result list. Same policy as the stores.
      return [];
    }
  });
}

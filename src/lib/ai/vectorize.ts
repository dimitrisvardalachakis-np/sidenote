import "server-only";
import { getCloudflareEnv } from "@/lib/platform/env";
import type { SourceType } from "@/lib/schemas";

/**
 * Vectorize — one index, two namespaces, and a boundary that must not leak.
 *
 * CLAUDE.md: "Company docs and FDA labels, separately namespaced | Vectorize".
 * One index rather than two, because Vectorize namespaces are a filter applied
 * inside the index and that is exactly the shape wanted: the same query, run
 * against one corpus or the other, never both.
 *
 * THE NAMESPACE IS THE CONFIDENTIALITY BOUNDARY.
 *
 * Company documents are CCDS and Investigator's Brochure text. The intake chat
 * has no login by design. A query that reached across the namespace would quote
 * confidential company documents to anonymous members of the public — a
 * disclosure incident wearing the costume of a helpful answer. That exact bug
 * was caught once already, in the rework commit, which is why `audience` is a
 * required argument throughout the retrieval layer rather than an option with a
 * default.
 *
 * So `namespace` is required here too, and it is derived from SourceType rather
 * than passed as a free string. There is no call that omits it and no call that
 * can spell it wrong.
 *
 * WHAT COULD NOT BE VERIFIED: Vectorize has no local emulation — `wrangler dev`
 * cannot stand one up, and there is no Cloudflare account on this machine. The
 * code is written and typechecked; it has never returned a real neighbour. Said
 * plainly rather than implied away.
 */

export function namespaceFor(sourceType: SourceType): string {
  return sourceType;
}

export interface VectorRecord {
  /** The chunk id — `${documentId}#${ordinal}`, so upserts are idempotent. */
  readonly id: string;
  readonly values: readonly number[];
  readonly namespace: string;
  readonly metadata: {
    readonly documentId: string;
    readonly sourceType: string;
    readonly ordinal: number;
  };
}

export interface VectorMatch {
  readonly id: string;
  /** Cosine similarity. NOT comparable with a BM25 score — see fuseByRank. */
  readonly score: number;
}

export type VectorizeOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

interface VectorizeBinding {
  upsert(vectors: readonly VectorRecord[]): Promise<unknown>;
  query(
    vector: readonly number[],
    options: {
      topK: number;
      namespace?: string;
      returnValues?: boolean;
      returnMetadata?: boolean | "none" | "indexed" | "all";
    },
  ): Promise<unknown>;
}

async function binding(): Promise<VectorizeBinding | null> {
  const env = await getCloudflareEnv();
  const index = env?.VECTORIZE as VectorizeBinding | undefined;
  return index ?? null;
}

export async function vectorizeAvailable(): Promise<boolean> {
  return (await binding()) !== null;
}

export async function upsertVectors(
  vectors: readonly VectorRecord[],
): Promise<VectorizeOutcome<number>> {
  if (vectors.length === 0) return { ok: true, value: 0 };

  const index = await binding();
  if (index === null) return { ok: false, reason: "no_vectorize_binding" };

  try {
    await index.upsert(vectors);
    return { ok: true, value: vectors.length };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.name : "upsert_failed",
    };
  }
}

function readMatches(response: unknown): readonly VectorMatch[] | null {
  if (typeof response !== "object" || response === null) return null;
  const matches = (response as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return null;

  const parsed: VectorMatch[] = [];
  for (const match of matches) {
    if (typeof match !== "object" || match === null) return null;
    const { id, score } = match as { id?: unknown; score?: unknown };
    if (typeof id !== "string" || typeof score !== "number") return null;
    parsed.push({ id, score });
  }
  return parsed;
}

/**
 * Nearest neighbours within ONE namespace.
 *
 * `sourceType` rather than a namespace string: the caller states which corpus
 * it is entitled to search, in the same vocabulary the rest of the app uses,
 * and cannot express "both".
 */
export async function queryVectors(
  vector: readonly number[],
  sourceType: SourceType,
  topK: number,
): Promise<VectorizeOutcome<readonly VectorMatch[]>> {
  const index = await binding();
  if (index === null) return { ok: false, reason: "no_vectorize_binding" };

  try {
    const response = await index.query(vector, {
      topK,
      namespace: namespaceFor(sourceType),
      // The vectors themselves are never wanted back: the chunk text lives in
      // D1 precisely so a citation can be rendered without a second vector
      // call, which is CLAUDE.md's pipeline step 7.
      returnValues: false,
      returnMetadata: "none",
    });

    const matches = readMatches(response);
    if (matches === null) {
      return { ok: false, reason: "unrecognised_vectorize_response" };
    }
    return { ok: true, value: matches };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.name : "query_failed",
    };
  }
}

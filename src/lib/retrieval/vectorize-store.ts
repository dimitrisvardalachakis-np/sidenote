/**
 * Cloudflare Vectorize over REST v2, wearing the `VectorStore` interface.
 *
 * The same argument as `http-binding.ts`: `env.VECTORIZE` only exists inside a
 * Worker, and a store that only works after a deployment is a store nobody can
 * develop against. REST works everywhere, so the opt-in path needs no wrangler
 * config and no Workers runtime — only an index, a token permission and an
 * environment variable.
 *
 * THE THING THIS FILE GUARDS AGAINST
 *
 * `DENSE_MIN_COSINE = 0.55` governs both implementations, and it is only
 * meaningful if `score` is a cosine SIMILARITY where higher is better. Vectorize
 * indexes can also be created `euclidean` or `dot-product`, and a euclidean
 * index returns a DISTANCE where lower is better. Point the same floor at that
 * and it inverts silently: every unrelated passage clears 0.55 and every good
 * one is rejected. Nothing throws, nothing logs, and a reviewer is shown
 * confident citations to the least relevant paragraphs in the document.
 *
 * So the index config is read once and cached, and a non-cosine index is
 * refused. Refusing surfaces as `unavailableReason` — lexical-only retrieval,
 * honestly labelled — which is the correct degradation. A wrong ranking is not.
 *
 * WHAT IS DELIBERATELY NOT SENT TO THE SERVICE
 *
 * `documentId` stays out of the metadata filter. Three reasons, in order of
 * weight: the wrong-product guarantee must not depend on a remote service's
 * filter semantics (`dense.ts` post-filters unconditionally and that is the
 * guarantee); the compact filter JSON is capped at 2048 bytes, so a `$in` of
 * UUIDs breaks at around fifty documents; and Vectorize allows at most ten
 * metadata indexes, which is a budget worth spending on the low-cardinality
 * property rather than the high-cardinality one.
 */
import { z } from "zod";
import { fetchJson, FetchJsonError } from "@/lib/fetch";
import { ChunkId, DocumentId, SourceType } from "@/lib/schemas";
import type {
  VectorMatch,
  VectorQuery,
  VectorRecord,
  VectorStore,
} from "./vectors";

/** Vectorize caps a single upsert batch; well under it on purpose. */
export const VECTORIZE_UPSERT_BATCH = 500;

/** Long enough for a cold index, short enough not to hang a reviewer's button. */
export const VECTORIZE_TIMEOUT_MS = 15_000;

export interface VectorizeConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly indexName: string;
  /** Overridable so a test can point the real client at a local stub. */
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const Envelope = z.object({
  success: z.boolean(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string() }))
    .default([]),
});

/**
 * The index description, narrowed to the one field that can silently corrupt a
 * ranking. Everything else Vectorize reports is ignored on purpose — a schema
 * that insists on fields it does not use breaks on the service's next additive
 * change, and this one runs before every query.
 */
const IndexConfig = Envelope.extend({
  result: z.object({
    config: z.object({
      dimensions: z.number(),
      metric: z.string(),
    }),
  }),
});

const QueryResponse = Envelope.extend({
  result: z.object({
    matches: z
      .array(
        z.object({
          id: z.string(),
          score: z.number(),
          metadata: z
            .object({
              documentId: z.string().optional(),
              sourceType: z.string().optional(),
              activeSubstance: z.string().optional(),
            })
            .optional(),
        }),
      )
      .default([]),
  }),
});

function base(config: VectorizeConfig): string {
  return (
    config.baseUrl?.replace(/\/$/, "") ??
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/v2`
  );
}

/** Errors are re-thrown as plain Errors; `denseSearch` turns them into a reason. */
function asError(cause: unknown): Error {
  if (cause instanceof FetchJsonError) {
    return new Error(`${cause.kind}: ${cause.message}`, { cause });
  }
  return new Error(
    cause instanceof Error ? cause.message : "the vector store could not be reached",
    { cause },
  );
}

class VectorizeStore implements VectorStore {
  readonly kind = "vectorize" as const;
  readonly #config: VectorizeConfig;
  /**
   * The metric check's result, cached for the lifetime of the store.
   *
   * An index's metric is fixed at creation and cannot be altered, so re-reading
   * it per query would spend a round trip to learn something that cannot have
   * changed. Cached as a promise so concurrent first queries share one call
   * rather than racing to make the same one.
   */
  #metric: Promise<void> | null = null;

  constructor(config: VectorizeConfig) {
    this.#config = config;
  }

  #headers(contentType: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.#config.apiToken}`,
      "content-type": contentType,
    };
  }

  #signal(): AbortSignal {
    return AbortSignal.timeout(this.#config.timeoutMs ?? VECTORIZE_TIMEOUT_MS);
  }

  /** Throws unless the index is cosine. See the file header for why. */
  async #requireCosine(): Promise<void> {
    this.#metric ??= (async () => {
      let described;
      try {
        described = await fetchJson(
          `${base(this.#config)}/indexes/${encodeURIComponent(this.#config.indexName)}`,
          IndexConfig,
          { method: "GET", headers: this.#headers("application/json"), signal: this.#signal() },
        );
      } catch (cause) {
        throw asError(cause);
      }

      const { metric, dimensions } = described.result.config;
      if (metric !== "cosine") {
        throw new Error(
          `Vectorize index "${this.#config.indexName}" uses the ${metric} metric, but the relevance floor is a cosine similarity where higher is better — a ${metric} index would invert it silently. Recreate the index with {"metric":"cosine"}.`,
        );
      }
      /*
        Dimensions are checked here too, and for the same class of reason.
        Vectorize rejects a wrong-width vector at upsert, so a mismatch would
        surface eventually — but it would surface as a confusing write failure
        during ingestion rather than as a sentence naming the cause, and until
        somebody uploaded a document the index would look healthy while
        returning nothing.
      */
      if (dimensions !== 768) {
        throw new Error(
          `Vectorize index "${this.#config.indexName}" holds ${dimensions}-dimension vectors, but @cf/baai/bge-base-en-v1.5 produces 768.`,
        );
      }
    })().catch((cause: unknown) => {
      // Do not cache a transport failure as a permanent verdict: a 522 on the
      // first query would otherwise disable the index for the process's life.
      this.#metric = null;
      throw cause instanceof Error ? cause : asError(cause);
    });

    return this.#metric;
  }

  async upsert(records: readonly VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.#requireCosine();

    for (let i = 0; i < records.length; i += VECTORIZE_UPSERT_BATCH) {
      const batch = records.slice(i, i + VECTORIZE_UPSERT_BATCH);
      /*
        NDJSON: one JSON object per line, no wrapping array. `upsert` rather
        than `insert` because a re-upload of the same document must replace its
        vectors, and `insert` refuses an id that already exists.
      */
      const body = batch
        .map((record) =>
          JSON.stringify({
            id: record.id,
            values: [...record.values],
            metadata: record.metadata,
          }),
        )
        .join("\n");

      try {
        await fetchJson(
          `${base(this.#config)}/indexes/${encodeURIComponent(this.#config.indexName)}/upsert`,
          Envelope,
          {
            method: "POST",
            headers: this.#headers("application/x-ndjson"),
            body,
            signal: this.#signal(),
          },
        );
      } catch (cause) {
        throw asError(cause);
      }
    }
  }

  async query(query: VectorQuery): Promise<readonly VectorMatch[]> {
    await this.#requireCosine();

    let response;
    try {
      response = await fetchJson(
        `${base(this.#config)}/indexes/${encodeURIComponent(this.#config.indexName)}/query`,
        QueryResponse,
        {
          method: "POST",
          headers: this.#headers("application/json"),
          body: JSON.stringify({
            vector: [...query.vector],
            topK: query.topK,
            returnValues: false,
            // Needed: `dense.ts` reads `metadata` off every match, and without
            // this Vectorize returns ids and scores only.
            returnMetadata: "indexed",
            // sourceType only. See the file header for why documentId is not
            // here and why that is a decision rather than an omission.
            filter: { sourceType: { $eq: query.sourceType } },
          }),
          signal: this.#signal(),
        },
      );
    } catch (cause) {
      throw asError(cause);
    }

    const matches: VectorMatch[] = [];
    for (const match of response.result.matches) {
      /*
        A match whose metadata does not parse is DROPPED, not defaulted.

        Defaulting `sourceType` would be the worst available option: it decides
        which namespace a passage belongs to, and a company CCDS quietly
        relabelled `public` is a confidential document rendered on a public
        screen. `dense.ts` would still refuse to hydrate anything the mirror
        does not confirm, so this is the second lock on that door rather than
        the only one — but a default here would be a lie manufactured at the
        boundary, and the boundary is where it must not happen.
      */
      const documentId = DocumentId.safeParse(match.metadata?.documentId);
      const sourceType = SourceType.safeParse(match.metadata?.sourceType);
      const id = ChunkId.safeParse(match.id);
      if (!documentId.success || !sourceType.success || !id.success) continue;

      matches.push({
        id: id.data,
        score: match.score,
        metadata: {
          documentId: documentId.data,
          sourceType: sourceType.data,
          activeSubstance: match.metadata?.activeSubstance ?? "unknown",
        },
      });
    }

    return matches;
  }
}

export function createVectorizeStore(config: VectorizeConfig): VectorStore {
  return new VectorizeStore(config);
}

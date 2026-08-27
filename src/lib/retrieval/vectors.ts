/**
 * The vector store boundary, and how the app decides which one it has.
 *
 * The analogue of `assess/ai.ts`, deliberately: one structural interface, two
 * implementations, and a resolver that prefers the real thing, falls back, and
 * says truthfully which happened. The reason for the symmetry is that the two
 * halves fail the same way and a reviewer has to be able to read the same kind
 * of honest sentence about either.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT
 *
 *   A vector store contributes an id and a rank. Nothing else.
 *
 * It never supplies chunk text, never supplies a citation, and never decides
 * scope. Text comes from the library mirror or the passage is dropped — see
 * `dense.ts`. That one sentence is what keeps a stale, leaked or
 * wrong-product vector from ever becoming a wrong citation, which is the
 * cardinal sin of this project.
 */
import type { ChunkId, DocumentId, SourceType } from "@/lib/schemas";
import type { AiAvailability, AiGatewayConfig } from "@/lib/assess/ai";
import { createEmbedder, type Embedder, type Vector } from "./embed";

/**
 * What is stored alongside a vector.
 *
 * Small on purpose. `sourceType` is the confidentiality boundary and
 * `documentId` is the product scope; `activeSubstance` is a low-cardinality
 * pre-filter hint. Vectorize caps indexed metadata at 64 bytes per property
 * per vector, and all three fit.
 */
export interface VectorMetadata {
  readonly documentId: DocumentId;
  readonly sourceType: SourceType;
  readonly activeSubstance: string;
}

export interface VectorRecord {
  /** `${documentId}#${ordinal}` — ~40 bytes, inside Vectorize's 64-byte cap. */
  readonly id: ChunkId;
  readonly values: Vector;
  readonly metadata: VectorMetadata;
}

export interface VectorQuery {
  readonly vector: Vector;
  readonly topK: number;
  readonly sourceType: SourceType;
  /**
   * The only documents whose passages may be cited for this case.
   *
   * Every implementation enforces this, always. A remote metadata filter is an
   * optimisation that reduces over-fetching; it is never the guarantee. See
   * `scope.ts` for what happens when a Covaxil case cites a Hepalex CCDS.
   */
  readonly documentIds: ReadonlySet<DocumentId>;
  /** Optional narrowing hint. Correctness must never depend on it. */
  readonly activeSubstances?: readonly string[] | undefined;
}

export interface VectorMatch {
  readonly id: ChunkId;
  /**
   * Cosine similarity, -1..1, higher is more similar.
   *
   * Contractual, not incidental: one `DENSE_MIN_COSINE` governs both
   * implementations, so a store that returned a Euclidean distance — where
   * lower is better — would invert the floor silently. The Vectorize
   * implementation refuses to query a non-cosine index for exactly this reason.
   */
  readonly score: number;
  readonly metadata: VectorMetadata;
}

export interface VectorStore {
  readonly kind: "local" | "vectorize";
  upsert(records: readonly VectorRecord[]): Promise<void>;
  query(query: VectorQuery): Promise<readonly VectorMatch[]>;
}

/*
  Deliberately absent from the interface:

  `size()` / `isEmpty()` — the `source_unavailable` state is decided by
  `namespaceIsEmpty`, which reads the mirrored chunks. "Is a document held for
  this product" is a question about the library; an empty or unreachable vector
  index has nothing to say about it. Providing a way to ask would invite
  exactly the wrong wiring.

  `delete()` — a re-upload replaces by chunk id where the ids collide, and any
  stale id that survives is dropped at hydration. Deletion is a Cluster E queue
  concern, and a method nothing calls would be a lie about what is implemented.
*/

export interface VectorStoreAvailability {
  readonly store: VectorStore | null;
  /**
   * Why you are not on the preferred path.
   *
   * Note this is NON-NULL on the working local path, which differs from
   * `resolveAiBinding`, where null means "fine". The local store works, but it
   * is not the architecture CLAUDE.md describes, and a screen that says
   * nothing about running brute-force cosine over a JSON file is the sort of
   * quiet overclaim NOTES.md exists to catch. `source` carries the
   * machine-readable answer; `reason` carries the honest sentence.
   */
  readonly reason: string | null;
  readonly source: "vectorize" | "local" | "none";
}

/** Everything the dense half needs: a model to embed with, and somewhere to look. */
export interface DenseAvailability {
  readonly embedder: Embedder | null;
  readonly store: VectorStore | null;
  readonly reason: string | null;
  readonly source: "vectorize" | "local" | "none";
}

function readString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Which vector store this environment has.
 *
 * The ladder mirrors `resolveAiBinding` step for step:
 *   1. an explicit off switch, checked first so it beats any credentials
 *   2. Vectorize, when an index name AND both credentials are present
 *   3. the local store, otherwise — including when Vectorize is half
 *      configured, because a missing token must not take semantic search down
 *      any more than a missing gateway takes generation down
 */
export function resolveVectorStore(
  env: Readonly<Record<string, unknown>>,
  createLocal: () => VectorStore,
  createVectorize: (config: {
    accountId: string;
    apiToken: string;
    indexName: string;
    baseUrl: string | undefined;
  }) => VectorStore,
): VectorStoreAvailability {
  if (readString(env, "SIDENOTE_VECTOR_DISABLED") === "1") {
    return {
      store: null,
      reason: "semantic retrieval is disabled by configuration",
      source: "none",
    };
  }

  const indexName = readString(env, "SIDENOTE_VECTORIZE_INDEX");
  const accountId = readString(env, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = readString(env, "CLOUDFLARE_API_TOKEN");

  if (indexName !== null && accountId !== null && apiToken !== null) {
    return {
      store: createVectorize({
        accountId,
        apiToken,
        indexName,
        baseUrl: readString(env, "SIDENOTE_VECTORIZE_BASE_URL") ?? undefined,
      }),
      reason: null,
      source: "vectorize",
    };
  }

  // Half-configured. Name the missing half rather than falling back silently —
  // somebody who set the index name believes they are on Vectorize.
  if (indexName !== null) {
    const missing =
      accountId === null && apiToken === null
        ? "neither CLOUDFLARE_ACCOUNT_ID nor CLOUDFLARE_API_TOKEN is set"
        : accountId === null
          ? "CLOUDFLARE_ACCOUNT_ID is not set"
          : "CLOUDFLARE_API_TOKEN is not set";
    return {
      store: createLocal(),
      reason: `SIDENOTE_VECTORIZE_INDEX is set but ${missing} — using the local index instead`,
      source: "local",
    };
  }

  return {
    store: createLocal(),
    reason:
      "no Vectorize index is configured — using the local file-backed index, which is brute-force cosine over every vector and does not scale past a few thousand chunks",
    source: "local",
  };
}

/**
 * The dense half, composed: a store to look in and a model to embed with.
 *
 * `embedder` is null exactly when generation is unavailable, so
 * `SIDENOTE_AI_DISABLED=1` switches off the whole dense half too. That is not
 * a coincidence to work around — it is the honest coupling. Semantic search
 * needs the same model access generation does, and a system with no model
 * should degrade in one direction, not two.
 */
export function resolveDense(
  ai: AiAvailability,
  gateway: AiGatewayConfig | null,
  vectors: VectorStoreAvailability,
): DenseAvailability {
  if (ai.binding === null) {
    return {
      embedder: null,
      store: null,
      reason: `semantic search needs the same model access generation does — ${ai.reason ?? "no model is configured"}`,
      source: "none",
    };
  }

  if (vectors.store === null) {
    return {
      embedder: null,
      store: null,
      reason: vectors.reason ?? "no vector store is configured",
      source: "none",
    };
  }

  return {
    embedder: createEmbedder(ai.binding, gateway),
    store: vectors.store,
    reason: vectors.reason,
    source: vectors.source,
  };
}

export type { Vector, Embedder };

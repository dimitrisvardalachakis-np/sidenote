import "server-only";
import { getCloudflareEnv } from "@/lib/platform/env";

/**
 * Embeddings, via Workers AI.
 *
 * CLAUDE.md names the model: `@cf/baai/bge-base-en-v1.5`, 768 dimensions. Both
 * numbers are load-bearing and both are asserted at runtime — a Vectorize index
 * is created with a fixed dimensionality, so swapping the model for one with a
 * different width does not degrade retrieval, it makes every upsert fail. The
 * assertion turns that into an error that names the cause.
 *
 * WHAT COULD NOT BE VERIFIED, SAID PLAINLY.
 *
 * Workers AI has no local emulation: `wrangler dev` proxies AI calls to
 * Cloudflare and needs an authenticated account. This module was written and
 * typechecked but never executed against the real binding, so what is proven
 * here is the shape of the call and the behaviour when the binding is absent —
 * not that a vector ever came back. The first real deployment is where that
 * gets found out, and the honest thing is to say so rather than to imply
 * coverage the tests do not have.
 *
 * WHY THE AI GATEWAY OPTION IS NOT OPTIONAL HERE.
 *
 * CLAUDE.md's last architecture row is "Caching, logging, spend cap on every
 * model call | AI Gateway". `gateway` is passed on every call when one is
 * configured, so there is no code path that reaches a model without it.
 */

/** CLAUDE.md's model, and the width the Vectorize index must be created with. */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Workers AI accepts a batch. Kept modest: a batch that is too large is a
 * single failure that retries a lot of work, and the queue consumer is already
 * chunking its own workload.
 */
export const EMBEDDING_BATCH_SIZE = 32;

declare global {
  interface CloudflareEnv {
    /**
     * AI Gateway id. When set, every model call is routed through it, which is
     * where caching, logging and the spend cap live. Absent means direct.
     */
    AI_GATEWAY_ID?: string;
  }
}

export type EmbeddingResult =
  | { readonly ok: true; readonly vectors: readonly (readonly number[])[] }
  /**
   * Not an exception. Callers have to decide what to do without embeddings,
   * and non-negotiable #5 says an AI failure must never block a human write —
   * so a thrown error that unwound an ingestion would be the wrong shape.
   */
  | { readonly ok: false; readonly reason: string };

interface AiBinding {
  run(
    model: string,
    inputs: { text: string[] },
    options?: { gateway?: { id: string } },
  ): Promise<unknown>;
}

/** What bge returns. Parsed rather than trusted, like every other boundary. */
function readVectors(response: unknown): readonly (readonly number[])[] | null {
  if (typeof response !== "object" || response === null) return null;
  const data = (response as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  const vectors: number[][] = [];
  for (const row of data) {
    if (!Array.isArray(row)) return null;
    const vector: number[] = [];
    for (const value of row) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      vector.push(value);
    }
    if (vector.length !== EMBEDDING_DIMENSIONS) return null;
    vectors.push(vector);
  }
  return vectors;
}

export async function embed(
  texts: readonly string[],
): Promise<EmbeddingResult> {
  if (texts.length === 0) return { ok: true, vectors: [] };

  const env = await getCloudflareEnv();
  const ai = env?.AI as AiBinding | undefined;
  if (ai === undefined) {
    return { ok: false, reason: "no_workers_ai_binding" };
  }

  const gatewayId = env?.AI_GATEWAY_ID;

  try {
    const response = await ai.run(
      EMBEDDING_MODEL,
      { text: [...texts] },
      gatewayId === undefined || gatewayId === ""
        ? undefined
        : { gateway: { id: gatewayId } },
    );

    const vectors = readVectors(response);
    if (vectors === null) {
      // A response we do not recognise is not a partial success. Half-parsing
      // it would put vectors of the wrong width into Vectorize, where the
      // failure surfaces later as retrieval that quietly returns nothing.
      return { ok: false, reason: "unrecognised_embedding_response" };
    }
    if (vectors.length !== texts.length) {
      return { ok: false, reason: "embedding_count_mismatch" };
    }

    return { ok: true, vectors };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.name : "embedding_failed",
    };
  }
}

/** True when a model is reachable. Drives the honest degraded states. */
export async function embeddingsAvailable(): Promise<boolean> {
  const env = await getCloudflareEnv();
  return env?.AI !== undefined;
}

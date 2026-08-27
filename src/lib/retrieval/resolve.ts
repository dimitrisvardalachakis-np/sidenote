import "server-only";
/**
 * One call that answers "what dense retrieval does this environment have".
 *
 * `resolveVectorStore` takes the two implementations as arguments so it can be
 * tested without either of them being reachable — `local-vectors.ts` touches
 * `node:fs` and `vectorize-store.ts` touches the network. This file is where
 * the real pair gets supplied, and it is the only place that imports both.
 *
 * Call sites stay two lines: `resolveDenseFor(env, ai)` next to the
 * `resolveAiBinding(env)` they already have.
 */
import { resolveGateway, type AiAvailability } from "@/lib/assess/ai";
import { createLocalVectorStore, provenanceOf } from "./local-vectors";
import { createVectorizeStore } from "./vectorize-store";
import { resolveDense, resolveVectorStore, type DenseAvailability } from "./vectors";

export function resolveDenseFor(
  env: Readonly<Record<string, unknown>>,
  ai: AiAvailability,
): DenseAvailability {
  return resolveDense(
    ai,
    resolveGateway(env),
    resolveVectorStore(
      env,
      // The provenance stamp. This is the only place that knows both the
      // environment and which store is being built, which is why it is bound
      // here rather than read inside the store.
      () => createLocalVectorStore(provenanceOf(env)),
      (config) => createVectorizeStore(config),
    ),
  );
}

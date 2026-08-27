/**
 * Turning text into vectors, with `@cf/baai/bge-base-en-v1.5`.
 *
 * This is the half of hybrid retrieval that the synonym table in search.ts has
 * been standing in for. That table has 24 rows; a reporter writing "pins and
 * needles" never reaches a label saying "paraesthesia", and when retrieval
 * misses the model is never asked and the panel says "No matching passage" —
 * which reads as a finding. An embedding is what closes that gap.
 *
 * Nothing here decides anything. It produces vectors; ranking happens in
 * dense.ts, fusion in search.ts, and the citation is always rendered from the
 * mirrored chunk text rather than from anything a vector store returns.
 */
import {
  AiEmbeddingResponse,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type AiBinding,
  type AiGatewayConfig,
  type AiRunOptions,
} from "@/lib/assess/ai";
import type { DocumentChunk } from "@/lib/schemas";

export type Vector = readonly number[];

/** One method, so a test can fake it in a line. */
export interface Embedder {
  embed(texts: readonly string[]): Promise<readonly Vector[]>;
}

/**
 * The character budget for one embedding.
 *
 * bge truncates past 512 tokens. The chunker targets ~512 tokens and estimates
 * them as `chars / 4`, but that is an estimate, and clinical text tokenises
 * worse than prose — long words, numbers, percentages, section numbers like
 * "4.8" all cost more tokens per character than the average. The chunker also
 * allows a hard split at 1024 tokens, so a chunk can legitimately be twice the
 * target. 1600 characters is roughly 400 estimated tokens, leaving about 20%
 * headroom against the real limit.
 *
 * TRUNCATION COSTS RECALL, NEVER CORRECTNESS. The citation, the rendered
 * excerpt and the verbatim check all run against the full `chunk.text`. Nobody
 * should ever "fix" this limit by truncating the chunk itself — that would
 * make the tail of a passage unquotable rather than merely harder to find.
 */
export const EMBED_MAX_CHARS = 1_600;

/**
 * Texts per request. bge accepts an array, so ingestion is not one call per
 * chunk. Fifty keeps a request body around 100 KB.
 */
export const EMBED_BATCH_SIZE = 50;

/**
 * Deliberately half the generation timeout.
 *
 * The dense half is a recall improvement on a button a reviewer is waiting at.
 * The generation they are actually waiting for must never be held hostage by
 * it, so an embedding that has not returned in five seconds is abandoned and
 * retrieval proceeds lexically.
 */
export const EMBED_TIMEOUT_MS = 5_000;

/**
 * The exact string that gets embedded for a chunk.
 *
 * Exported and pure because BOTH the ingestion path and the seed-vector
 * generator call it. If they built the string differently the committed
 * artifact would not match what production produces, and the seeded corpus
 * would rank differently from an uploaded one for no visible reason.
 *
 * The section heading is prepended because "4.8 Undesirable effects" is a
 * strong signal about what a passage is for, and the chunk body frequently
 * does not repeat it.
 */
export function embedTextFor(
  chunk: Pick<DocumentChunk, "section" | "text">,
): string {
  const prefix = chunk.section === null ? "" : `${chunk.section}\n`;
  return truncateForEmbedding(`${prefix}${chunk.text}`);
}

/**
 * Cut at a sentence boundary where there is one, a word boundary otherwise.
 *
 * A hard mid-word slice is a worse vector than a slightly shorter one, and
 * cutting deterministically means the same chunk always produces the same
 * embedding — which is what lets the committed seed artifact be checked
 * against a hash rather than re-embedded to compare.
 */
export function truncateForEmbedding(
  text: string,
  maxChars: number = EMBED_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;

  const window = text.slice(0, maxChars);
  const sentence = window.lastIndexOf(". ");
  if (sentence > maxChars / 2) return window.slice(0, sentence + 1);

  const space = window.lastIndexOf(" ");
  return space > 0 ? window.slice(0, space) : window;
}

/** Split into batches, preserving order. */
function batched<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`embedding call exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createEmbedder(
  binding: AiBinding,
  gateway: AiGatewayConfig | null,
  timeoutMs: number = EMBED_TIMEOUT_MS,
): Embedder {
  const options: AiRunOptions =
    gateway === null
      ? {}
      : {
          gateway: {
            id: gateway.id,
            cacheTtl: gateway.cacheTtlSeconds,
            skipCache: gateway.skipCache,
          },
        };

  return {
    async embed(texts: readonly string[]): Promise<readonly Vector[]> {
      if (texts.length === 0) return [];

      const out: Vector[] = [];

      /*
        Batches run one after another, not concurrently.

        Two reasons, and the first is the same one that makes assessCase read
        its namespaces sequentially: `aiGatewayLogId` is a mutable property the
        binding overwrites per call, so overlapping calls race on it. The
        second is that ingestion is not a screen anybody is waiting at, and a
        burst of parallel requests against a free-tier account is a worse
        trade than a few extra seconds.
      */
      for (const batch of batched(texts, EMBED_BATCH_SIZE)) {
        const raw = await withTimeout(
          binding.run(EMBEDDING_MODEL, { text: batch }, options),
          timeoutMs,
        );

        // Parsed, not asserted. The reply is data from outside the process,
        // and the schema is what catches a model returning 384 dimensions.
        const parsed = AiEmbeddingResponse.parse(raw);

        /*
          THE CHECK THAT MATTERS MOST IN THIS FILE.

          If a batch of three texts comes back with two vectors, zipping them
          against the chunks shifts every subsequent chunk's vector by one —
          permanently, silently, and with no symptom except that the index
          ranks the wrong passages forever afterwards. That is a
          wrong-citation generator with no error message, so it throws rather
          than degrading.
        */
        if (parsed.data.length !== batch.length) {
          throw new Error(
            `embedding count mismatch: sent ${batch.length} texts, received ${parsed.data.length} vectors`,
          );
        }

        out.push(...parsed.data);
      }

      return out;
    },
  };
}

/** Re-exported so callers need one import to describe one thing. */
export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL };

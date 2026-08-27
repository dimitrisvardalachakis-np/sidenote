/**
 * The seed-vector generator, which is a test only so that it can import `@/`.
 *
 * There is no `tsx` or `vite-node` in this project, and a plain `.mjs` script
 * cannot resolve the `@/` alias or the TypeScript fixtures. Vitest already
 * resolves both exactly as the app does — that is the stated reason the alias
 * exists in vitest.config.mts — so the generator lives here, gated on an
 * environment variable and therefore a genuine no-op inside `npm run build`.
 *
 * The smell is real: a test that writes a file into the repository. The
 * mitigations are that its assertions are real assertions about the vectors it
 * received, that it cannot run by accident, and that the alternative is adding
 * a dependency to run twenty lines of glue.
 *
 *   npm run embed:seed
 *
 * It needs real credentials. Pointing it at the stub server would produce an
 * artifact of hashed word buckets labelled as bge output — a file claiming an
 * inference that never happened, which is the exact fiction this codebase has
 * already had to unpick once.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  resolveAiBinding,
  resolveGateway,
} from "@/lib/assess/ai";
import { createEmbedder, embedTextFor } from "@/lib/retrieval/embed";
import { SEED_CHUNKS } from "./documents";
import { SEED_VECTOR_PATH } from "./vectors";

/** Stable across processes, unlike a hash of an object. */
export function seedTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const ENABLED = process.env["SIDENOTE_EMBED_SEED"] === "1";

describe.runIf(ENABLED)("regenerating the seed vector artifact", () => {
  it("embeds every seed chunk and writes the artifact", async () => {
    const env = { ...process.env };
    const ai = resolveAiBinding(env);
    if (ai.binding === null) {
      throw new Error(
        `no model is configured, so seed vectors cannot be generated — ${ai.reason ?? "unknown reason"}`,
      );
    }
    if (env["SIDENOTE_AI_BASE_URL"] !== undefined) {
      throw new Error(
        "SIDENOTE_AI_BASE_URL is set, which points at the stub server. The stub " +
          "hashes words into buckets; an artifact of those labelled as bge output " +
          "would claim an inference that never happened. Unset it and use real " +
          "credentials.",
      );
    }

    const embedder = createEmbedder(ai.binding, resolveGateway(env), 60_000);
    const texts = SEED_CHUNKS.map(embedTextFor);
    const vectors = await embedder.embed(texts);

    expect(vectors).toHaveLength(SEED_CHUNKS.length);
    for (const values of vectors) {
      expect(values).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(values.every((v) => Number.isFinite(v))).toBe(true);
    }

    const artifact = {
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      generatedAt: new Date().toISOString(),
      vectors: SEED_CHUNKS.map((chunk, index) => ({
        id: chunk.id,
        textHash: seedTextHash(texts[index] ?? ""),
        // Six decimals. Cosine is insensitive at that precision and the file
        // stays a readable diff rather than an opaque wall of float noise.
        values: (vectors[index] ?? []).map((v) => Number(v.toFixed(6))),
      })),
    };

    await writeFile(
      SEED_VECTOR_PATH,
      `${JSON.stringify(artifact, null, 0)}\n`,
      "utf8",
    );
  }, 120_000);
});

/**
 * The embedder's contract. The load-bearing claim is the count check: a short
 * reply must throw rather than silently shifting every subsequent chunk's
 * vector by one, which is a wrong-citation generator with no symptom.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import { EMBEDDING_DIMENSIONS, type AiBinding, type AiRunInput } from "@/lib/assess/ai";
import {
  EMBED_BATCH_SIZE,
  EMBED_MAX_CHARS,
  createEmbedder,
  embedTextFor,
  truncateForEmbedding,
} from "./embed";

const vector = (seed: number): number[] =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? seed : 0));

/** Records what the binding was asked, and answers with one vector per text. */
function recordingBinding(
  answer: (texts: readonly string[]) => number[][] = (texts) =>
    texts.map((_t, i) => vector(i)),
) {
  const calls: AiRunInput[] = [];
  const binding: AiBinding = {
    run: (_model, input) => {
      calls.push(input);
      const texts = "text" in input ? input.text : [];
      return Promise.resolve({ data: answer(texts) });
    },
    aiGatewayLogId: "aig-1",
  };
  return { binding, calls };
}

describe("what goes on the wire", () => {
  it("sends the embedding shape, not the generation shape", async () => {
    const { binding, calls } = recordingBinding();
    await createEmbedder(binding, null).embed(["a", "b"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ text: ["a", "b"] });
  });

  it("forwards gateway options so query embeddings are cached", async () => {
    // Two reviewers assessing the same case issue the same embedding. A cached
    // identical vector is not merely cheaper — it is the same ranking.
    const seen: unknown[] = [];
    const binding: AiBinding = {
      run: (_m, _i, options) => {
        seen.push(options);
        return Promise.resolve({ data: [vector(1)] });
      },
      aiGatewayLogId: null,
    };
    await createEmbedder(binding, {
      id: "sidenote",
      cacheTtlSeconds: 3600,
      skipCache: false,
    }).embed(["a"]);
    expect(seen[0]).toEqual({
      gateway: { id: "sidenote", cacheTtl: 3600, skipCache: false },
    });
  });

  it("spends nothing on an empty list", async () => {
    const { binding, calls } = recordingBinding();
    expect(await createEmbedder(binding, null).embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("batching", () => {
  it("splits past the batch size and preserves order across batches", async () => {
    const texts = Array.from({ length: EMBED_BATCH_SIZE + 10 }, (_v, i) => `t${i}`);
    // Answer with a vector whose first element encodes the text's identity, so
    // a reordering between batches would be visible.
    const { binding, calls } = recordingBinding((batch) =>
      batch.map((t) => vector(Number(t.slice(1)))),
    );

    const out = await createEmbedder(binding, null).embed(texts);

    expect(calls).toHaveLength(2);
    expect(out).toHaveLength(texts.length);
    for (const [i, v] of out.entries()) expect(v[0]).toBe(i);
  });
});

describe("a short reply is a hard failure, not a degradation", () => {
  it("throws when fewer vectors come back than texts went out", async () => {
    // The silent version of this bug shifts every subsequent chunk's vector by
    // one and the index ranks the wrong passages forever.
    const { binding } = recordingBinding((texts) => texts.slice(1).map((_t, i) => vector(i)));
    await expect(createEmbedder(binding, null).embed(["a", "b", "c"])).rejects.toThrow(
      /count mismatch: sent 3 texts, received 2/,
    );
  });

  it("throws when a vector has the wrong number of dimensions", async () => {
    // A silently swapped model returning 384 dims into a 768 index.
    const binding: AiBinding = {
      run: () => Promise.resolve({ data: [[1, 2, 3]] }),
      aiGatewayLogId: null,
    };
    await expect(createEmbedder(binding, null).embed(["a"])).rejects.toThrow();
  });

  it("throws on a reply that is not the embedding shape at all", async () => {
    const binding: AiBinding = {
      run: () => Promise.resolve({ response: "I am a chat model" }),
      aiGatewayLogId: null,
    };
    await expect(createEmbedder(binding, null).embed(["a"])).rejects.toThrow();
  });

  it("gives up rather than hanging", async () => {
    const binding: AiBinding = {
      run: () => new Promise(() => {}),
      aiGatewayLogId: null,
    };
    await expect(createEmbedder(binding, null, 20).embed(["a"])).rejects.toThrow(
      /exceeded 20ms/,
    );
  });
});

describe("what text represents a chunk", () => {
  const chunk = (over: Partial<DocumentChunk>): DocumentChunk => ({
    id: ChunkId.parse("00000001-0000-4000-8000-000000000001#0"),
    documentId: DocumentId.parse("00000001-0000-4000-8000-000000000001"),
    sourceType: "company",
    section: "4.8 Undesirable effects",
    ordinal: 0,
    text: "Jaundice has been reported rarely.",
    charStart: 0,
    charEnd: 34,
    tokenEstimate: 9,
    ...over,
  });

  it("prepends the section, which the body often does not repeat", () => {
    expect(embedTextFor(chunk({}))).toBe(
      "4.8 Undesirable effects\nJaundice has been reported rarely.",
    );
  });

  it("omits the section when there is none", () => {
    expect(embedTextFor(chunk({ section: null }))).toBe(
      "Jaundice has been reported rarely.",
    );
  });

  it("leaves text under the budget untouched", () => {
    const text = "short enough";
    expect(truncateForEmbedding(text)).toBe(text);
  });

  it("cuts at a sentence boundary when there is one", () => {
    const text = `${"word ".repeat(200)}End of sentence. ${"tail ".repeat(200)}`;
    const cut = truncateForEmbedding(text);
    expect(cut.length).toBeLessThanOrEqual(EMBED_MAX_CHARS);
    expect(cut.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary rather than slicing mid-word", () => {
    // No sentence terminator anywhere in the window.
    const text = "supercalifragilistic ".repeat(200);
    const cut = truncateForEmbedding(text);
    expect(cut.length).toBeLessThanOrEqual(EMBED_MAX_CHARS);
    expect(text.startsWith(cut)).toBe(true);
    expect(cut.endsWith("supercalifragilistic")).toBe(true);
  });

  it("is deterministic, which is what lets the seed artifact be hash-checked", () => {
    const c = chunk({ text: "x".repeat(5000) });
    expect(embedTextFor(c)).toBe(embedTextFor(c));
  });
});

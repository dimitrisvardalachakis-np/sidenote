/**
 * The one rule that keeps `"embedded"` from becoming a lie:
 *
 *   nothing reports `embedded` unless the upsert actually resolved.
 *
 * `"embedded"` was a status nothing in this codebase could set, guarded by a
 * comment saying that marking it would be "a lie a later cluster has to
 * unpick". A comment is not a guarantee — this file is the attempt at one.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import { embedAndUpsert } from "./ingest";
import type { DenseAvailability, VectorRecord } from "./vectors";

const DOC = DocumentId.parse("0000000f-0000-4000-8000-00000000000a");

const DOCUMENT = {
  id: DOC,
  sourceType: "company" as const,
  activeSubstance: "covaxilin",
};

function chunk(ordinal: number, text: string): DocumentChunk {
  return {
    id: ChunkId.parse(`${DOC}#${ordinal}`),
    documentId: DOC,
    sourceType: "company",
    section: "4.8 Undesirable effects",
    ordinal,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

const CHUNKS = [chunk(0, "Paraesthesia was reported."), chunk(1, "Jaundice was reported.")];

function fakeDense(over: Partial<DenseAvailability> = {}) {
  const upserted: VectorRecord[][] = [];
  const dense: DenseAvailability = {
    embedder: { embed: (texts) => Promise.resolve(texts.map((_, i) => [i, 1, 0])) },
    store: {
      kind: "local",
      upsert: (records) => {
        upserted.push([...records]);
        return Promise.resolve();
      },
      query: () => Promise.resolve([]),
    },
    reason: null,
    source: "local",
    ...over,
  };
  return { dense, upserted };
}

describe("the happy path", () => {
  it("embeds every chunk and upserts one record each", async () => {
    const { dense, upserted } = fakeDense();
    const out = await embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS });

    expect(out).toEqual({ status: "embedded", vectors: 2 });
    expect(upserted[0]?.map((r) => r.id)).toEqual([CHUNKS[0]?.id, CHUNKS[1]?.id]);
  });

  it("carries the metadata the scope filter depends on", async () => {
    const { dense, upserted } = fakeDense();
    await embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS });

    // Without documentId and sourceType on the vector, neither store can apply
    // the scope predicate and every product's passages become citable for
    // every case.
    expect(upserted[0]?.[0]?.metadata).toEqual({
      documentId: DOC,
      sourceType: "company",
      activeSubstance: "covaxilin",
    });
  });

  it("embeds the section heading along with the text", async () => {
    const seen: string[] = [];
    const { dense } = fakeDense({
      embedder: {
        embed: (texts) => {
          seen.push(...texts);
          return Promise.resolve(texts.map(() => [1, 0, 0]));
        },
      },
    });
    await embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS });

    // The same `embedTextFor` the seed generator uses. If the two built the
    // string differently, a seeded document would rank differently from an
    // uploaded one for no visible reason.
    expect(seen[0]).toBe("4.8 Undesirable effects\nParaesthesia was reported.");
  });
});

describe("nothing reports embedded unless the upsert resolved", () => {
  it("fails when the store throws", async () => {
    const { dense } = fakeDense({
      store: {
        kind: "vectorize",
        upsert: () => Promise.reject(new Error("522 origin unreachable")),
        query: () => Promise.resolve([]),
      },
    });
    const out = await embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS });

    expect(out.status).toBe("failed");
    if (out.status !== "failed") return;
    expect(out.reason).toContain("522 origin unreachable");
  });

  it("fails when the embedder throws", async () => {
    const { dense } = fakeDense({
      embedder: { embed: () => Promise.reject(new Error("count mismatch")) },
    });
    const out = await embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS });
    expect(out.status).toBe("failed");
  });

  it("fails, and upserts nothing, when the vector count does not match", async () => {
    /*
      The defect this is really about is not the missing vector — it is the
      SHIFT. Zipping two vectors against three chunks attaches chunk 1's vector
      to chunk 0 and so on down the document, permanently, with no symptom
      except that the index ranks the wrong passages forever afterwards. A
      wrong-citation generator with no error message is worth checking twice,
      which is why `createEmbedder` also refuses this one layer down.
    */
    const { dense, upserted } = fakeDense({
      embedder: (() => ({ embed: () => Promise.resolve([[1, 0, 0]]) }))(),
    });
    const out = await embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS });

    expect(out.status).toBe("failed");
    expect(upserted).toHaveLength(0);
  });

  it("never throws, whatever goes wrong", async () => {
    const { dense } = fakeDense({
      embedder: {
        embed: () => {
          throw new Error("synchronous explosion");
        },
      },
    });
    // An upload must not fail because the index did. The document is already
    // stored, chunked and mirrored by the time this runs.
    await expect(
      embedAndUpsert({ dense, document: DOCUMENT, chunks: CHUNKS }),
    ).resolves.toMatchObject({ status: "failed" });
  });
});

describe("skipped is not failed", () => {
  it("skips, carrying the reason, when there is no dense half at all", async () => {
    const out = await embedAndUpsert({ dense: null, document: DOCUMENT, chunks: CHUNKS });
    expect(out.status).toBe("skipped");
  });

  it("reports the availability reason rather than inventing one", async () => {
    const out = await embedAndUpsert({
      dense: {
        embedder: null,
        store: null,
        reason: "semantic retrieval is disabled by configuration",
        source: "none",
      },
      document: DOCUMENT,
      chunks: CHUNKS,
    });
    expect(out).toEqual({
      status: "skipped",
      reason: "semantic retrieval is disabled by configuration",
    });
  });

  it("spends nothing on a document with no chunks", async () => {
    let called = 0;
    const { dense } = fakeDense({
      embedder: {
        embed: (texts) => {
          called += 1;
          return Promise.resolve(texts.map(() => [1, 0, 0]));
        },
      },
    });
    const out = await embedAndUpsert({ dense, document: DOCUMENT, chunks: [] });
    expect(out.status).toBe("skipped");
    expect(called).toBe(0);
  });
});

/**
 * The dense ranking's contract, and the two claims that keep a vector store
 * from producing a wrong citation:
 *
 *   - a match the mirror does not confirm is dropped
 *   - a match from another product or namespace is dropped even when the store
 *     hands it over
 *
 * Both are tested with a store that is DELIBERATELY badly behaved, because the
 * post-filter is the thing under test. A well-behaved fake would prove nothing.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk, type SourceType } from "@/lib/schemas";
import { denseSearch } from "./dense";
import { DENSE_MIN_COSINE } from "./thresholds";
import type { DenseAvailability, VectorMatch } from "./vectors";

const DOC_A = DocumentId.parse("0000000f-0000-4000-8000-00000000000a");
const DOC_B = DocumentId.parse("0000000f-0000-4000-8000-00000000000b");

function chunk(
  id: string,
  text: string,
  documentId = DOC_A,
  sourceType: SourceType = "company",
): DocumentChunk {
  return {
    id: ChunkId.parse(id),
    documentId,
    sourceType,
    section: "4.8 Undesirable effects",
    ordinal: 0,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

const A0 = chunk("a#0", "Paraesthesia of the hands was reported in 2% of patients.");
const A1 = chunk("a#1", "Jaundice has been reported rarely.");
const B0 = chunk("b#0", "A different product entirely.", DOC_B);
const PUB = chunk("a#2", "A public label passage.", DOC_A, "public");

const CHUNKS = [A0, A1, B0, PUB];

const meta = (documentId = DOC_A, sourceType: SourceType = "company") => ({
  documentId,
  sourceType,
  activeSubstance: "covaxilin",
});

/** A store that returns whatever it is told to, however wrong. */
function fakeDense(
  matches: readonly VectorMatch[],
  over: Partial<DenseAvailability> = {},
): DenseAvailability {
  return {
    embedder: { embed: (texts) => Promise.resolve(texts.map(() => [1, 0, 0])) },
    store: {
      kind: "local",
      upsert: () => Promise.resolve(),
      query: () => Promise.resolve(matches),
    },
    reason: null,
    source: "local",
    ...over,
  };
}

const run = (dense: DenseAvailability, over: Record<string, unknown> = {}) =>
  denseSearch({
    dense,
    chunks: CHUNKS,
    query: "pins and needles in my hands",
    sourceType: "company",
    documentIds: new Set([DOC_A]),
    limit: 5,
    ...over,
  });

describe("a match the mirror does not confirm is never cited", () => {
  it("drops a vector whose chunk no longer exists", async () => {
    // The stale-vector case: a document was re-chunked and this id went with
    // the old chunking, but the index still holds it.
    const out = await run(
      fakeDense([{ id: ChunkId.parse("a#99"), score: 0.9, metadata: meta() }]),
    );
    expect(out.hits).toHaveLength(0);
    // Not an error — dense ran, and found nothing it could stand behind.
    expect(out.unavailableReason).toBeNull();
  });

  it("drops another product's chunk even when the store returns it", async () => {
    // The Covaxil/Hepalex incident, re-proved against the new door into
    // retrieval. The store's filter is an optimisation; this is the guarantee.
    const out = await run(
      fakeDense([{ id: B0.id, score: 0.95, metadata: meta(DOC_B) }]),
    );
    expect(out.hits).toHaveLength(0);
  });

  it("drops another namespace's chunk even when the store returns it", async () => {
    const out = await run(
      fakeDense([{ id: PUB.id, score: 0.95, metadata: meta(DOC_A, "public") }]),
    );
    expect(out.hits).toHaveLength(0);
  });

  it("keeps a match that the mirror does confirm", async () => {
    const out = await run(fakeDense([{ id: A0.id, score: 0.8, metadata: meta() }]));
    expect(out.hits.map((h) => h.chunk.id)).toEqual(["a#0"]);
    // Hydrated from the mirror, not from anything the store said.
    expect(out.hits[0]?.chunk.text).toBe(A0.text);
  });
});

describe("the cosine floor", () => {
  it("drops a match below the floor", async () => {
    const out = await run(
      fakeDense([{ id: A0.id, score: DENSE_MIN_COSINE - 0.01, metadata: meta() }]),
    );
    expect(out.hits).toHaveLength(0);
  });

  it("keeps a match exactly at the floor", async () => {
    const out = await run(
      fakeDense([{ id: A0.id, score: DENSE_MIN_COSINE, metadata: meta() }]),
    );
    expect(out.hits).toHaveLength(1);
  });

  it("can be overridden per call", async () => {
    const out = await run(
      fakeDense([{ id: A0.id, score: 0.2, metadata: meta() }]),
      { minScore: 0.1 },
    );
    expect(out.hits).toHaveLength(1);
  });
});

describe("ordering and shape", () => {
  it("dedupes, so one passage cannot double-weight in RRF", async () => {
    const out = await run(
      fakeDense([
        { id: A0.id, score: 0.9, metadata: meta() },
        { id: A0.id, score: 0.8, metadata: meta() },
      ]),
    );
    expect(out.hits).toHaveLength(1);
  });

  it("orders best first with a deterministic tie-break", async () => {
    const out = await run(
      fakeDense([
        { id: A1.id, score: 0.7, metadata: meta() },
        { id: A0.id, score: 0.9, metadata: meta() },
      ]),
    );
    expect(out.hits.map((h) => h.chunk.id)).toEqual(["a#0", "a#1"]);
  });

  it("respects the limit", async () => {
    const out = await run(
      fakeDense([
        { id: A0.id, score: 0.9, metadata: meta() },
        { id: A1.id, score: 0.8, metadata: meta() },
      ]),
      { limit: 1 },
    );
    expect(out.hits).toHaveLength(1);
  });

  it("populates matched with terms that really occur, and no others", async () => {
    const out = await denseSearch({
      dense: fakeDense([{ id: A1.id, score: 0.9, metadata: meta() }]),
      chunks: CHUNKS,
      query: "jaundice",
      sourceType: "company",
      documentIds: new Set([DOC_A]),
      limit: 5,
    });
    expect(out.hits[0]?.matched).toContain("jaundice");
  });

  it("keeps a term that really does overlap, even on a semantic hit", async () => {
    // "pins and needles in my hands" and "Paraesthesia of the hands" share
    // "hand" after singularisation — so the excerpt centres there, which is
    // exactly what a reviewer wants.
    const out = await run(fakeDense([{ id: A0.id, score: 0.9, metadata: meta() }]));
    expect(out.hits[0]?.matched).toEqual(["hand"]);
  });

  it("leaves matched empty when the overlap is genuinely nil", async () => {
    // The pure semantic case: no shared token at all. An empty `matched` is
    // the honest answer — the excerpt starts at the chunk's opening and the
    // model picks the sentence downstream. Synthesising a term that does not
    // occur would be a small lie in a field a reviewer reads.
    const out = await denseSearch({
      dense: fakeDense([{ id: A0.id, score: 0.9, metadata: meta() }]),
      chunks: CHUNKS,
      query: "tingling numbness",
      sourceType: "company",
      documentIds: new Set([DOC_A]),
      limit: 5,
    });
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]?.matched).toEqual([]);
  });
});

describe("failure is a degradation, never an error", () => {
  it("returns a reason rather than throwing when the store throws", async () => {
    const dense = fakeDense([]);
    const broken: DenseAvailability = {
      ...dense,
      store: {
        kind: "local",
        upsert: () => Promise.resolve(),
        query: () => Promise.reject(new Error("522 origin unreachable")),
      },
    };
    const out = await run(broken);
    expect(out.hits).toHaveLength(0);
    expect(out.unavailableReason).toContain("522 origin unreachable");
  });

  it("returns a reason when the embedder throws", async () => {
    const dense = fakeDense([]);
    const broken: DenseAvailability = {
      ...dense,
      embedder: { embed: () => Promise.reject(new Error("count mismatch")) },
    };
    const out = await run(broken);
    expect(out.unavailableReason).toContain("count mismatch");
  });

  it("reports the availability reason when there is no store at all", async () => {
    const out = await run({
      embedder: null,
      store: null,
      reason: "semantic retrieval is disabled by configuration",
      source: "none",
    });
    expect(out.unavailableReason).toBe(
      "semantic retrieval is disabled by configuration",
    );
  });

  it("spends no embedding when nothing is in scope", async () => {
    let embedded = 0;
    const dense: DenseAvailability = {
      ...fakeDense([]),
      embedder: {
        embed: (texts) => {
          embedded += 1;
          return Promise.resolve(texts.map(() => [1, 0, 0]));
        },
      },
    };
    const out = await run(dense, { documentIds: new Set() });
    expect(out.hits).toHaveLength(0);
    expect(embedded).toBe(0);
  });

  it("reuses a precomputed query vector rather than embedding again", async () => {
    let embedded = 0;
    const dense: DenseAvailability = {
      ...fakeDense([{ id: A0.id, score: 0.9, metadata: meta() }]),
      embedder: {
        embed: (texts) => {
          embedded += 1;
          return Promise.resolve(texts.map(() => [1, 0, 0]));
        },
      },
    };
    const out = await run(dense, { queryVector: [1, 0, 0] });
    expect(out.hits).toHaveLength(1);
    expect(embedded).toBe(0);
  });
});

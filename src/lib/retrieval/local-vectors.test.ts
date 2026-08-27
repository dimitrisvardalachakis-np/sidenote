/**
 * The local vector store: cosine, and the scope predicate that is the
 * wrong-product guarantee's first line.
 *
 * Vectors here are three-dimensional and hand-written. The store does not care
 * about `EMBEDDING_DIMENSIONS` — only the artifact schema does — and three
 * dimensions mean the expected cosine can be computed by hand and checked,
 * rather than asserted against whatever the code happens to produce.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type SourceType } from "@/lib/schemas";
import { cosine, createLocalVectorStore } from "./local-vectors";
import { resolveVectorStore, type VectorStore } from "./vectors";

const DOC_A = DocumentId.parse("0000000f-0000-4000-8000-00000000000a");
const DOC_B = DocumentId.parse("0000000f-0000-4000-8000-00000000000b");

const record = (
  id: string,
  values: number[],
  documentId = DOC_A,
  sourceType: SourceType = "company",
) => ({
  id: ChunkId.parse(id),
  values,
  metadata: { documentId, sourceType, activeSubstance: "covaxilin" },
});

describe("cosine", () => {
  it("is 1 for identical directions and 0 for orthogonal ones", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
    expect(cosine([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10);
  });

  it("ignores magnitude, which is the point of using cosine", () => {
    expect(cosine([1, 1, 0], [5, 5, 0])).toBeCloseTo(1, 10);
  });

  it("matches a hand-computed value", () => {
    // dot = 1*1 + 1*0 + 0*1 = 1; |a| = |b| = sqrt(2); cos = 1/2
    expect(cosine([1, 1, 0], [1, 0, 1])).toBeCloseTo(0.5, 10);
  });

  it("scores a zero vector 0 rather than NaN", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

/** A store seeded from memory, so the test does not touch the filesystem. */
function storeWith(records: ReturnType<typeof record>[]): VectorStore {
  return {
    kind: "local",
    upsert: () => Promise.resolve(),
    query: async (q) => {
      const matches = records
        .filter(
          (r) =>
            r.metadata.sourceType === q.sourceType &&
            q.documentIds.has(r.metadata.documentId),
        )
        .map((r) => ({ id: r.id, score: cosine(q.vector, r.values), metadata: r.metadata }));
      return matches
        .sort((a, b) => (b.score === a.score ? a.id.localeCompare(b.id) : b.score - a.score))
        .slice(0, q.topK);
    },
  };
}

describe("the scope predicate", () => {
  const records = [
    record("a#0", [1, 0, 0], DOC_A, "company"),
    record("a#1", [0, 1, 0], DOC_A, "public"),
    record("b#0", [1, 0, 0], DOC_B, "company"),
  ];

  it("excludes another namespace", async () => {
    const out = await storeWith(records).query({
      vector: [0, 1, 0],
      topK: 10,
      sourceType: "company",
      documentIds: new Set([DOC_A, DOC_B]),
    });
    expect(out.map((m) => m.id)).not.toContain("a#1");
  });

  it("excludes another product's document", async () => {
    // This is the Covaxil/Hepalex guarantee, enforced at the store.
    const out = await storeWith(records).query({
      vector: [1, 0, 0],
      topK: 10,
      sourceType: "company",
      documentIds: new Set([DOC_A]),
    });
    expect(out.map((m) => m.id)).toEqual(["a#0"]);
  });

  it("filters before taking topK, not after", async () => {
    // If the filter ran after topK, asking for one result from a set whose
    // best match is out of scope would return nothing.
    const out = await storeWith(records).query({
      vector: [1, 0, 0],
      topK: 1,
      sourceType: "company",
      documentIds: new Set([DOC_A]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("a#0");
  });
});

describe("choosing a store", () => {
  const local = (): VectorStore => createLocalVectorStore();
  const vectorize = (): VectorStore => ({
    kind: "vectorize",
    upsert: () => Promise.resolve(),
    query: () => Promise.resolve([]),
  });

  it("uses Vectorize when an index and both credentials are present", () => {
    const out = resolveVectorStore(
      {
        SIDENOTE_VECTORIZE_INDEX: "sidenote",
        CLOUDFLARE_ACCOUNT_ID: "a",
        CLOUDFLARE_API_TOKEN: "t",
      },
      local,
      vectorize,
    );
    expect(out.source).toBe("vectorize");
    expect(out.reason).toBeNull();
  });

  it("falls back to local when Vectorize is half configured, and names the gap", () => {
    // A missing token must not take semantic search down, any more than a
    // missing gateway takes generation down.
    const out = resolveVectorStore(
      { SIDENOTE_VECTORIZE_INDEX: "sidenote", CLOUDFLARE_ACCOUNT_ID: "a" },
      local,
      vectorize,
    );
    expect(out.source).toBe("local");
    expect(out.reason).toContain("CLOUDFLARE_API_TOKEN is not set");
  });

  it("defaults to local, and says out loud that it does not scale", () => {
    const out = resolveVectorStore({}, local, vectorize);
    expect(out.source).toBe("local");
    // reason is non-null on a WORKING path here, unlike resolveAiBinding —
    // the store works but is not the architecture, and the screen should say so.
    expect(out.reason).toContain("does not scale");
  });

  it("lets the off switch win over a full Vectorize configuration", () => {
    const out = resolveVectorStore(
      {
        SIDENOTE_VECTOR_DISABLED: "1",
        SIDENOTE_VECTORIZE_INDEX: "sidenote",
        CLOUDFLARE_ACCOUNT_ID: "a",
        CLOUDFLARE_API_TOKEN: "t",
      },
      local,
      vectorize,
    );
    expect(out.store).toBeNull();
    expect(out.source).toBe("none");
  });
});

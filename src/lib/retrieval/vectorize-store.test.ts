/**
 * The Vectorize client's wire protocol, and the check that stops a
 * misconfigured index from producing a confidently-wrong ranking.
 *
 * Every test here swaps `globalThis.fetch`, the same way `http-binding.test.ts`
 * does, so the real client is exercised end to end against a scripted service
 * rather than a mock of itself.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { ChunkId, DocumentId } from "@/lib/schemas";
import { createVectorizeStore, VECTORIZE_UPSERT_BATCH } from "./vectorize-store";
import type { VectorRecord } from "./vectors";

const CONFIG = {
  accountId: "acct-1",
  apiToken: "tok-1",
  indexName: "sidenote",
  baseUrl: undefined,
} as const;

const DOC = DocumentId.parse("0000000f-0000-4000-8000-00000000000a");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * A scripted Vectorize.
 *
 * `metric` and `dimensions` describe the index the client will discover; every
 * other route answers from `responses` keyed by the path suffix.
 */
function stubVectorize(
  options: {
    metric?: string;
    dimensions?: number;
    matches?: readonly unknown[];
    describeStatus?: number;
    queryStatus?: number;
  } = {},
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
    const href = String(url);
    calls.push({ url: href, init: (init ?? {}) as RequestInit });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (href.endsWith("/query")) {
      return json(
        { success: true, errors: [], result: { matches: options.matches ?? [] } },
        options.queryStatus ?? 200,
      );
    }
    if (href.endsWith("/upsert")) {
      return json({ success: true, errors: [], result: { mutationId: "m1" } });
    }
    // The describe call.
    return json(
      {
        success: true,
        errors: [],
        result: {
          config: {
            metric: options.metric ?? "cosine",
            dimensions: options.dimensions ?? 768,
          },
        },
      },
      options.describeStatus ?? 200,
    );
  }) as typeof fetch;
  return calls;
}

const record = (id: string, values: number[] = [1, 0, 0]): VectorRecord => ({
  id: ChunkId.parse(id),
  values,
  metadata: { documentId: DOC, sourceType: "company", activeSubstance: "covaxilin" },
});

const query = (topK = 5) => ({
  vector: [1, 0, 0],
  topK,
  sourceType: "company" as const,
  documentIds: new Set([DOC]),
});

const bodyOf = (call: Call | undefined): string =>
  typeof call?.init.body === "string" ? call.init.body : "";

const jsonBodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(bodyOf(call) || "{}") as Record<string, unknown>;

describe("a non-cosine index is refused, not queried", () => {
  /*
    The failure this prevents is the quiet one.

    DENSE_MIN_COSINE = 0.55 assumes a similarity where higher is better. A
    euclidean index returns a distance where lower is better, so the same floor
    admits everything unrelated and rejects everything good — with no error, no
    log line, and a reviewer shown confident citations to the least relevant
    paragraphs in the document. Refusing degrades to lexical-only, which is
    honest. Querying anyway is not.
  */
  it("throws for a euclidean index and names the fix", async () => {
    stubVectorize({ metric: "euclidean" });
    await expect(createVectorizeStore(CONFIG).query(query())).rejects.toThrow(
      /euclidean/,
    );
  });

  it("never sends the query when the metric is wrong", async () => {
    const calls = stubVectorize({ metric: "dot-product" });
    await createVectorizeStore(CONFIG).query(query()).catch(() => undefined);
    expect(calls.some((c) => c.url.endsWith("/query"))).toBe(false);
  });

  it("refuses a wrong-width index before anything is written to it", async () => {
    const calls = stubVectorize({ dimensions: 384 });
    await expect(
      createVectorizeStore(CONFIG).upsert([record("a#0")]),
    ).rejects.toThrow(/384/);
    expect(calls.some((c) => c.url.endsWith("/upsert"))).toBe(false);
  });

  it("reads the index config once, not once per query", async () => {
    const calls = stubVectorize();
    const store = createVectorizeStore(CONFIG);
    await store.query(query());
    await store.query(query());
    // An index's metric is fixed at creation, so re-reading it would spend a
    // round trip to learn something that cannot have changed.
    const describes = calls.filter(
      (c) => !c.url.endsWith("/query") && !c.url.endsWith("/upsert"),
    );
    expect(describes).toHaveLength(1);
  });

  it("does not cache a transport failure as a permanent verdict", async () => {
    // A 522 on the first query must not disable the index for the process's
    // life. The metric verdict is cacheable; a network failure is not.
    let attempts = 0;
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/query")) {
        return new Response(
          JSON.stringify({ success: true, errors: [], result: { matches: [] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      attempts += 1;
      if (attempts === 1) return new Response("origin unreachable", { status: 522 });
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: { config: { metric: "cosine", dimensions: 768 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const store = createVectorizeStore(CONFIG);
    await expect(store.query(query())).rejects.toThrow();
    await expect(store.query(query())).resolves.toEqual([]);
  });
});

describe("upsert", () => {
  it("sends NDJSON, one object per line, with no wrapping array", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).upsert([record("a#0"), record("a#1")]);

    const upsert = calls.find((c) => c.url.endsWith("/upsert"));
    const body = bodyOf(upsert);
    expect(body.startsWith("[")).toBe(false);
    expect(body.split("\n")).toHaveLength(2);
    expect(JSON.parse(body.split("\n")[0] ?? "{}")).toMatchObject({
      id: "a#0",
      metadata: { documentId: DOC, sourceType: "company" },
    });
  });

  it("declares the NDJSON content type", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).upsert([record("a#0")]);
    const upsert = calls.find((c) => c.url.endsWith("/upsert"));
    const headers = new Headers(upsert?.init.headers);
    expect(headers.get("content-type")).toBe("application/x-ndjson");
  });

  it("batches rather than sending an unbounded body", async () => {
    const calls = stubVectorize();
    const many = Array.from({ length: VECTORIZE_UPSERT_BATCH + 3 }, (_, i) =>
      record(`a#${i}`),
    );
    await createVectorizeStore(CONFIG).upsert(many);
    expect(calls.filter((c) => c.url.endsWith("/upsert"))).toHaveLength(2);
  });

  it("posts nothing at all for an empty batch", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).upsert([]);
    // Not even the describe call: there is nothing to check the index for.
    expect(calls).toHaveLength(0);
  });
});

describe("query", () => {
  it("filters on sourceType and deliberately not on documentId", async () => {
    /*
      documentId stays out of the filter on purpose, and the reasons are worth
      stating in a test because its absence looks like an omission:

        - the wrong-product guarantee must not depend on a remote service's
          filter semantics; `dense.ts` post-filters unconditionally
        - the compact filter JSON is capped at 2048 bytes, so a $in of UUIDs
          breaks at around fifty documents
        - Vectorize allows at most ten metadata indexes
    */
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).query(query());
    const body = jsonBodyOf(calls.find((c) => c.url.endsWith("/query")));
    expect(body.filter).toEqual({ sourceType: { $eq: "company" } });
    expect(JSON.stringify(body.filter)).not.toContain(DOC);
  });

  it("asks for metadata, without which dense.ts has nothing to read", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).query(query());
    const body = jsonBodyOf(calls.find((c) => c.url.endsWith("/query")));
    expect(body.returnMetadata).toBe("indexed");
    // Values are not wanted: the vector itself is never used after the search.
    expect(body.returnValues).toBe(false);
  });

  it("passes topK through", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).query(query(17));
    expect(jsonBodyOf(calls.find((c) => c.url.endsWith("/query"))).topK).toBe(17);
  });

  it("parses matches into the shape dense.ts expects", async () => {
    stubVectorize({
      matches: [
        {
          id: "a#0",
          score: 0.81,
          metadata: {
            documentId: DOC,
            sourceType: "company",
            activeSubstance: "covaxilin",
          },
        },
      ],
    });
    const out = await createVectorizeStore(CONFIG).query(query());
    expect(out).toEqual([
      {
        id: "a#0",
        score: 0.81,
        metadata: {
          documentId: DOC,
          sourceType: "company",
          activeSubstance: "covaxilin",
        },
      },
    ]);
  });

  it("drops a match whose sourceType did not come back, rather than defaulting it", async () => {
    /*
      A default here would be the worst available option. `sourceType` decides
      which namespace a passage belongs to, and a company CCDS quietly
      relabelled `public` is a confidential document on a public screen.
      Dropping loses a result; defaulting invents a fact.
    */
    stubVectorize({
      matches: [{ id: "a#0", score: 0.9, metadata: { documentId: DOC } }],
    });
    expect(await createVectorizeStore(CONFIG).query(query())).toEqual([]);
  });

  it("drops a match with no metadata at all", async () => {
    stubVectorize({ matches: [{ id: "a#0", score: 0.9 }] });
    expect(await createVectorizeStore(CONFIG).query(query())).toEqual([]);
  });

  it("drops a match whose documentId is not a uuid", async () => {
    stubVectorize({
      matches: [
        {
          id: "a#0",
          score: 0.9,
          metadata: { documentId: "not-a-uuid", sourceType: "company" },
        },
      ],
    });
    expect(await createVectorizeStore(CONFIG).query(query())).toEqual([]);
  });

  it("keeps a good match alongside a malformed one", async () => {
    // One bad row must not blind the whole query.
    stubVectorize({
      matches: [
        { id: "a#bad", score: 0.99, metadata: { sourceType: "company" } },
        {
          id: "a#0",
          score: 0.8,
          metadata: { documentId: DOC, sourceType: "company" },
        },
      ],
    });
    const out = await createVectorizeStore(CONFIG).query(query());
    expect(out.map((m) => m.id)).toEqual(["a#0"]);
  });

  it("throws a message carrying the transport detail", async () => {
    // denseSearch turns this into `unavailableReason`, so the message is what a
    // reviewer eventually reads. "It failed" is not an audit line.
    stubVectorize({ queryStatus: 500 });
    await expect(createVectorizeStore(CONFIG).query(query())).rejects.toThrow(
      /http/,
    );
  });
});

describe("where the calls go", () => {
  it("uses the v2 REST base by default", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).query(query());
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/vectorize/v2/indexes/sidenote",
    );
  });

  it("honours an override so a test can point at a local stub", async () => {
    const calls = stubVectorize();
    await createVectorizeStore({ ...CONFIG, baseUrl: "http://localhost:8788/" }).query(
      query(),
    );
    expect(calls[0]?.url).toBe("http://localhost:8788/indexes/sidenote");
  });

  it("sends the bearer token", async () => {
    const calls = stubVectorize();
    await createVectorizeStore(CONFIG).query(query());
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
      "Bearer tok-1",
    );
  });
});

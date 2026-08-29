/**
 * Acquisition, and the one property that keeps this inside openFDA's
 * unauthenticated rate limit: a label already held is never fetched again.
 *
 * These run in a temporary working directory, because the library store writes
 * under `process.cwd()/.data` and a test that pollutes the repo's own data
 * directory would be a test that changes the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SafetyDocument } from "@/lib/schemas";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { DocumentId } from "@/lib/schemas";
import { ensurePublicLabel, withAcquiredLabel } from "./acquire";

const realFetch = globalThis.fetch;

const SPL = "00afce9b-48c9-487a-a738-e359c005c707";

const held = (over: Record<string, unknown> = {}): SafetyDocument =>
  SafetyDocument.parse({
    id: SPL,
    title: "Atorvastatin calcium — FDA Prescribing Information",
    kind: "fda_label",
    sourceType: "public",
    activeSubstance: "atorvastatin calcium",
    version: null,
    effectiveDate: null,
    objectKey: null,
    status: "embedded",
    rejectionReason: null,
    chunkCount: 3,
    uploadedAt: "2026-08-28T00:00:00.000Z",
    ...over,
  });

function stub(body: unknown, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const RESULT = {
  results: [
    {
      effective_time: "20250828",
      openfda: {
        brand_name: ["Atorvastatin calcium"],
        generic_name: ["atorvastatin calcium"],
        spl_set_id: [SPL],
      },
      adverse_reactions: [
        "6 ADVERSE REACTIONS Myalgia and arthralgia were reported commonly in clinical trials.",
      ],
    },
  ],
};

/*
  No chdir, deliberately — it would not work.

  `library-store.ts` computes `LIBRARY_DIR` from `process.cwd()` at MODULE
  LOAD, so the path is frozen when the module is first imported and changing
  the working directory afterwards has no effect at all. A first attempt at
  these tests chdir'd into a temp directory, believed it was isolated, and
  quietly wrote into the repository's own `.data/library` — the failure only
  surfaced because a later test found a document an earlier one had left
  behind. (`local-vectors.ts` uses a relative path resolved per call and does
  respond to chdir. The two stores differ, which is worth knowing.)

  So instead: write where the store writes, and remove exactly what was
  written.
*/
const LIBRARY_FILE = join(process.cwd(), ".data", "library", `${SPL}.json`);
const VECTOR_FILE = join(process.cwd(), ".data", "vectors", `${SPL}.json`);

async function clean() {
  await rm(LIBRARY_FILE, { force: true });
  await rm(VECTOR_FILE, { force: true });
}

beforeEach(clean);
afterEach(async () => {
  globalThis.fetch = realFetch;
  await clean();
});

describe("a label already held is never fetched again", () => {
  it("returns held, and spends no request", async () => {
    const calls = stub(RESULT);
    const out = await ensurePublicLabel({
      drugName: "atorvastatin",
      held: [held()],
      dense: null,
      actor: "public",
    });

    expect(out.status).toBe("held");
    // The library mirror IS the cache. Without this, a busy search page would
    // hit openFDA once per visitor per question.
    expect(calls).toHaveLength(0);
  });

  it("matches on the same predicate retrieval uses", async () => {
    // `documentGovernsDrug` does a prefix comparison, so the brand a reporter
    // types resolves to the label held under its generic name. Anything looser
    // would fetch a duplicate; anything stricter would re-fetch every time.
    const calls = stub(RESULT);
    const out = await ensurePublicLabel({
      drugName: "atorvastatin",
      held: [held({ activeSubstance: "atorvastatin calcium trihydrate" })],
      dense: null,
      actor: "public",
    });
    expect(out.status).toBe("held");
    expect(calls).toHaveLength(0);
  });

  it("does not treat a company document as a public label", async () => {
    // A CCDS for the same drug must never satisfy the public-label check —
    // expectedness is a question about the public label specifically.
    const calls = stub(RESULT);
    const out = await ensurePublicLabel({
      drugName: "atorvastatin",
      held: [
        SafetyDocument.parse({
          ...held(),
          kind: "ccds",
          sourceType: "company",
        }),
      ],
      dense: null,
      actor: "public",
    });
    expect(out.status).toBe("acquired");
    expect(calls).toHaveLength(1);
  });
});

describe("acquiring", () => {
  it("fetches, chunks and mirrors the label", async () => {
    stub(RESULT);
    const out = await ensurePublicLabel({
      drugName: "atorvastatin",
      held: [],
      dense: null,
      actor: "public",
    });

    expect(out.status).toBe("acquired");
    if (out.status !== "acquired") return;
    expect(out.chunks).toBeGreaterThan(0);

    // In the library, so `loadCorpus` picks it up and it is citable.
    const entry = await getDocumentLibrary().get(SPL);
    expect(entry).not.toBeNull();
    expect(entry?.document.sourceType).toBe("public");
    expect(entry?.chunks.length).toBe(out.chunks);
    expect(entry?.chunks[0]?.text).toContain("Myalgia");
  });

  it("stays at chunking, not embedded, when there is no embedder", async () => {
    // The same rule the upload path follows: "embedded" is only ever written
    // downstream of an upsert that resolved.
    stub(RESULT);
    await ensurePublicLabel({
      drugName: "atorvastatin",
      held: [],
      dense: null,
      actor: "public",
    });
    const entry = await getDocumentLibrary().get(SPL);
    expect(entry?.document.status).toBe("chunking");
  });
});

describe("failure never blocks an answer", () => {
  it("returns not_found on a 404 without throwing", async () => {
    stub({ error: { code: "NOT_FOUND" } }, 404);
    await expect(
      ensurePublicLabel({ drugName: "nosuchdrug", held: [], dense: null, actor: "public" }),
    ).resolves.toMatchObject({ status: "not_found" });
  });

  it("returns unavailable when openFDA cannot be reached", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("dns"))) as typeof fetch;
    await expect(
      ensurePublicLabel({ drugName: "atorvastatin", held: [], dense: null, actor: "public" }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("writes nothing to the library when the fetch fails", async () => {
    stub({ error: "boom" }, 500);
    await ensurePublicLabel({
      drugName: "atorvastatin",
      held: [],
      dense: null,
      actor: "public",
    });
    expect(await getDocumentLibrary().get(SPL)).toBeNull();
  });
});

/**
 * The re-fetch loop, and the contradiction underneath it.
 *
 * A reporter searching "ABACAVIR SULFATE" produced three `fetch_fda_label`
 * lines in one minute for one label. The cache check and the search share a
 * predicate, so a name the predicate could not match was neither found in the
 * library nor searchable once fetched: openFDA was called again on every
 * request, and the reporter was told nothing was found about a document the
 * same page had just announced fetching.
 */
describe("the salt on the box does not defeat the cache", () => {
  it("recognises a held label when the reporter types the salt form", async () => {
    const calls = stub(RESULT);
    const out = await ensurePublicLabel({
      drugName: "ATORVASTATIN CALCIUM",
      held: [held({ activeSubstance: "atorvastatin" })],
      dense: null,
      actor: "public",
    });
    expect(out.status).toBe("held");
    // The whole point: no second request. The library mirror IS the cache,
    // and openFDA's unauthenticated rate limit is what it protects.
    expect(calls).toHaveLength(0);
  });
});

describe("the label a fetch resolved is always searchable", () => {
  const id = DocumentId.parse(SPL);
  const other = DocumentId.parse("11111111-1111-4111-8111-111111111111");

  it("pins an acquired label into scope", () => {
    const scope = withAcquiredLabel(new Set(), {
      status: "acquired",
      documentId: id,
      title: "Abacavir — FDA Prescribing Information",
      chunks: 24,
      embedded: false,
    });
    expect(scope.has(id)).toBe(true);
  });

  it("pins a held one too, since it is equally the answer to this name", () => {
    expect(withAcquiredLabel(new Set(), { status: "held", documentId: id }).has(id)).toBe(true);
  });

  it("only ever widens, and never by anything the fetch did not resolve", () => {
    const scope = withAcquiredLabel(new Set([other]), {
      status: "held",
      documentId: id,
    });
    expect([...scope].sort()).toEqual([id, other].sort());
  });

  it("adds nothing when nothing was resolved", () => {
    const base = new Set([other]);
    expect(withAcquiredLabel(base, null)).toBe(base);
    expect(
      withAcquiredLabel(base, { status: "not_found", reason: "no such drug" }),
    ).toBe(base);
    expect(
      withAcquiredLabel(base, { status: "unavailable", reason: "openFDA is down" }),
    ).toBe(base);
  });
});

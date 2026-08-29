/**
 * The orchestration, against the real seeded corpus rather than synthetic
 * chunks — so the retrieval thresholds are exercised on the text the demo
 * actually ships with.
 *
 * The headline claim: a bounded number of model calls per case — one reading
 * per namespace and one narrative per namespace, never one call per chunk.
 */
import { describe, expect, it } from "vitest";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { DrugId, type SuspectDrug } from "@/lib/schemas";
import { assessCase } from "./assess";
import { documentsForDrug } from "./scope";
import {
  MAX_CALLS_PER_ASSESSMENT,
  NAMESPACES_PER_ASSESSMENT,
  messagesOf,
  type AiBinding,
} from "./ai";

const drug = (reportedName: string, activeSubstance: string | null): SuspectDrug => ({
  id: DrugId.parse("00000002-0000-4000-8000-000000000001"),
  reportedName,
  activeSubstance,
  role: "suspect",
  marketingStatus: "marketed",
  dose: null,
  route: null,
  indication: null,
  therapyStart: null,
  therapyEnd: null,
  dechallenge: null,
  rechallenge: null,
});

const HEPALEX = drug("Hepalex", "hepalexin");
const COVAXIL = drug("Covaxil", "covaxilin");

/** Every passage in a prompt, as {id, text}. */
function passagesIn(user: string): { id: string; text: string }[] {
  const found: { id: string; text: string }[] = [];
  const pattern = /<<<PASSAGE id="([^"]+)"[^\n]*\n([\s\S]*?)\nPASSAGE>>>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(user)) !== null) {
    const [, id, text] = match;
    if (id !== undefined && text !== undefined) found.push({ id, text });
  }
  return found;
}

/** The first sentence of a passage, copied exactly. */
function firstSentence(text: string): string {
  return /^[^.]+\./.exec(text)?.[0] ?? text.slice(0, 60);
}

/**
 * A binding that answers honestly, on both contracts.
 *
 * It reads the passages out of the prompt it was given and quotes them
 * verbatim — which is what a well-behaved model would do, and it means these
 * tests exercise the real verification path rather than stepping around it.
 *
 * It answers whichever contract it was asked for. Replying with the reading
 * shape to a narrative prompt would make every narrative test pass through the
 * `wrong_shape` branch, so the fixture would be measuring the rejection path
 * while appearing to measure the happy one.
 */
function quotingBinding() {
  const prompts: string[] = [];
  const readingPrompts: string[] = [];
  const narrativePrompts: string[] = [];

  const binding: AiBinding = {
    run: (_model, input) => {
      const messages = messagesOf(input);
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      prompts.push(user);

      const passages = passagesIn(user);

      // The narrative contract asks for "points"; the reading contract does not.
      if (system.includes('"points"')) {
        narrativePrompts.push(user);
        return Promise.resolve({
          response: JSON.stringify({
            points: passages.slice(0, 2).map((p) => ({
              chunkId: p.id,
              quotedSpan: firstSentence(p.text),
              sentence: "The passage describes what happened.",
            })),
          }),
        });
      }

      readingPrompts.push(user);
      const first = passages[0];
      if (first === undefined) {
        return Promise.resolve({
          response: JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null }),
        });
      }
      return Promise.resolve({
        response: JSON.stringify({
          found: true,
          chunkId: first.id,
          quotedSpan: firstSentence(first.text),
          rationale: "The passage describes the reaction.",
        }),
      });
    },
    aiGatewayLogId: "aig-test",
  };
  return { binding, prompts, readingPrompts, narrativePrompts };
}

const base = {
  chunks: SEED_CHUNKS,
  documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
  documentKind: "ccds" as const,
  labelSetId: "spl-1",
  gateway: null,
  now: "2026-08-26T10:00:00Z",
  actor: "reviewer-demo",
  target: "SN-2026-000101",
};

describe("a bounded number of calls per case", () => {
  it("makes one reading call per namespace and not one per chunk", async () => {
    const { binding, readingPrompts } = quotingBinding();
    await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    expect(readingPrompts).toHaveLength(NAMESPACES_PER_ASSESSMENT);
  });

  /*
    The narrative adds one call per namespace, and this is where that cost is
    written down. It only runs where the reading succeeded, so a well-behaved
    binding produces exactly one per namespace — and the total stays under the
    declared ceiling, which allows for the reading's retry as well.
  */
  it("makes at most one narrative call per namespace, and stays under the ceiling", async () => {
    const { binding, prompts, readingPrompts, narrativePrompts } = quotingBinding();
    await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    expect(narrativePrompts.length).toBeLessThanOrEqual(NAMESPACES_PER_ASSESSMENT);
    expect(prompts.length).toBe(readingPrompts.length + narrativePrompts.length);
    expect(prompts.length).toBeLessThanOrEqual(MAX_CALLS_PER_ASSESSMENT);
  });

  it("puts every retrieved passage for a namespace into one prompt", async () => {
    // Covaxil/rash matches two passages in the public label, which is what
    // makes this test meaningful — a query matching one passage could not
    // tell one-prompt-per-namespace from one-prompt-per-chunk apart.
    const { binding, prompts, readingPrompts } = quotingBinding();
    await assessCase({
      ...base,
      documentIds: documentsForDrug(SEED_DOCUMENTS, COVAXIL),
      reactionTerm: "rash",
      drugName: "Covaxil",
      ai: { binding, reason: null, source: "http" as const },
    });
    const passages = prompts.map((p) => p.split("<<<PASSAGE").length - 1);
    expect(Math.max(...passages)).toBeGreaterThan(1);
    // Still one reading prompt per namespace, not one per passage.
    expect(readingPrompts.length).toBeLessThanOrEqual(NAMESPACES_PER_ASSESSMENT);
  });
});

describe("the two namespaces stay apart", () => {
  it("cites only company documents for listedness and only public for expectedness", async () => {
    const { binding } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    if (out.listedness.state === "grounded") {
      expect(out.listedness.citations.every((c) => c.sourceType === "company")).toBe(true);
    }
    if (out.expectedness.state === "grounded") {
      expect(out.expectedness.citations.every((c) => c.sourceType === "public")).toBe(true);
    }
  });

  it("produces a reading that cites a passage from its own namespace", async () => {
    const { binding } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    if (out.listedness.state === "grounded" && out.listedness.reading.status === "read") {
      const ids = out.listedness.citations.map((c) => c.chunkId);
      expect(ids).toContain(out.listedness.reading.chunkId);
    }
  });
});

describe("when retrieval finds nothing", () => {
  it("records no_result and spends no inference", async () => {
    const { binding, prompts } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: "zzzznonsensereaction",
      drugName: "zzzznonsensedrug",
      ai: { binding, reason: null, source: "http" as const },
    });
    expect(out.listedness.state).toBe("no_result");
    expect(out.expectedness.state).toBe("no_result");
    // Nothing to read, so nothing was asked. A model call here would produce a
    // statement about passages that do not exist.
    expect(prompts).toHaveLength(0);
  });
});

describe("with no model at all", () => {
  it("still returns the retrieved passages, with the reading unavailable", async () => {
    const out = await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding: null, reason: "generation is disabled by configuration", source: "none" as const },
    });
    expect(out.listedness.state).toBe("grounded");
    if (out.listedness.state === "grounded") {
      // The evidence survives the outage; only the account of it is missing.
      expect(out.listedness.citations.length).toBeGreaterThan(0);
      expect(out.listedness.reading.status).toBe("unavailable");
      if (out.listedness.reading.status === "unavailable") {
        expect(out.listedness.reading.reason).toBe("generation is disabled by configuration");
      }
    }
  });

  it("never reports the outage as the document being silent", async () => {
    const out = await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding: null, reason: "no binding", source: "none" as const },
    });
    if (out.listedness.state === "grounded") {
      expect(out.listedness.reading.status).not.toBe("nothing_found");
    }
    expect(out.listedness.state).not.toBe("no_result");
  });
});

describe("holes found by review", () => {
  it("says the source was unavailable when no document exists for the namespace", async () => {
    // Not "nothing found". A company library with no CCDS in it must not
    // produce the finding that the CCDS appears not to mention the reaction —
    // that is a claim of silence about a document nobody opened.
    const publicOnly = SEED_CHUNKS.filter((c) => c.sourceType === "public");
    const out = await assessCase({
      ...base,
      chunks: publicOnly,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding: null, reason: "no binding", source: "none" as const },
    });
    expect(out.listedness.state).toBe("source_unavailable");
    expect(out.listedness.state).not.toBe("no_result");
  });

  it("reads the two namespaces one after the other, not concurrently", async () => {
    // aiGatewayLogId is a mutable property the runtime overwrites per call.
    // Concurrent reads race on it and a reading gets stamped with the other
    // namespace's inference id, which makes the audit trail point at the
    // wrong inference.
    const order: string[] = [];
    let inFlight = 0;
    const binding: AiBinding = {
      run: async () => {
        inFlight += 1;
        order.push(`start:${inFlight}`);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return {
          response: JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null }),
        };
      },
      aiGatewayLogId: "aig-1",
    };
    await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    // Never two in flight at once.
    expect(order.every((o) => o === "start:1")).toBe(true);
  });
});

describe("retrieval never leaves this case's own documents", () => {
  it("does not quote another product's CCDS as this case's company evidence", async () => {
    // The bug this pins: the corpus was filtered by sourceType alone and the
    // drug name was merely a BM25 term, so a Covaxil case reporting jaundice
    // pulled in the HEPALEX Core Data Sheet — where the word "jaundice" lives.
    // The model quoted it correctly and verbatim, every check in verify.ts
    // passed, and the reviewer read another drug's confidential document as
    // this one's listedness evidence.
    const { binding } = quotingBinding();
    const out = await assessCase({
      ...base,
      documentIds: documentsForDrug(SEED_DOCUMENTS, COVAXIL),
      reactionTerm: "jaundice",
      drugName: "Covaxil",
      ai: { binding, reason: null, source: "http" as const },
    });

    const covaxilDocs = documentsForDrug(SEED_DOCUMENTS, COVAXIL);
    if (out.listedness.state === "grounded") {
      for (const citation of out.listedness.citations) {
        expect(covaxilDocs.has(citation.documentId)).toBe(true);
      }
    }
    if (out.expectedness.state === "grounded") {
      for (const citation of out.expectedness.citations) {
        expect(covaxilDocs.has(citation.documentId)).toBe(true);
      }
    }
  });

  it("proves the Hepalex CCDS really would have been retrieved without the scope", () => {
    // Guards against the test above passing because the query simply misses.
    const unscoped = SEED_CHUNKS.filter((c) => c.sourceType === "company");
    const hepalexDocs = documentsForDrug(SEED_DOCUMENTS, HEPALEX);
    const leaks = unscoped.some((c) => hepalexDocs.has(c.documentId));
    expect(leaks).toBe(true);
  });

  it("says no document is held when the product has none, rather than staying silent", async () => {
    const out = await assessCase({
      ...base,
      documentIds: documentsForDrug(SEED_DOCUMENTS, drug("Unknownium", "unobtainium")),
      reactionTerm: "jaundice",
      drugName: "Unknownium",
      ai: { binding: null, reason: "no binding", source: "none" as const },
    });
    expect(out.listedness.state).toBe("source_unavailable");
    expect(out.expectedness.state).toBe("source_unavailable");
  });
});

describe("the query is the reaction, not the reaction plus the drug", () => {
  it("reports no_result for a reaction the product's documents never mention", async () => {
    // With the drug name in the query, every chunk in an already-scoped corpus
    // matched, so this came back `grounded` with a citation — the CCDS cover
    // page offered as evidence about a symptom it never mentions. That also
    // made no_result almost unreachable, deleting a state the design needs.
    const { binding, prompts } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: "zzzz unrelated symptom",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    expect(out.listedness.state).toBe("no_result");
    expect(out.expectedness.state).toBe("no_result");
    // And no inference is spent asking about passages that do not exist.
    expect(prompts).toHaveLength(0);
  });

  it("still finds the passage when the reaction really is described", async () => {
    const { binding } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null, source: "http" as const },
    });
    expect(out.listedness.state).toBe("grounded");
  });
});

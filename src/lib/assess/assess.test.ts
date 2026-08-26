/**
 * The orchestration, against the real seeded corpus rather than synthetic
 * chunks — so the retrieval thresholds are exercised on the text the demo
 * actually ships with.
 *
 * The headline claim: two model calls per case, one per namespace, never one
 * per chunk.
 */
import { describe, expect, it } from "vitest";
import { SEED_CHUNKS } from "@/lib/fixtures/documents";
import { assessCase } from "./assess";
import type { AiBinding } from "./ai";

/**
 * A binding that answers honestly: it reads the passages out of the prompt it
 * was given and quotes the first sentence of the first one. Verbatim by
 * construction, which is what a well-behaved model would do — and it means
 * these tests exercise the real verification path rather than stepping around
 * it.
 */
function quotingBinding() {
  const prompts: string[] = [];
  const binding: AiBinding = {
    run: (_model, input) => {
      const user = input.messages.find((m) => m.role === "user")?.content ?? "";
      prompts.push(user);
      const match = /<<<PASSAGE id="([^"]+)"[^\n]*\n([\s\S]*?)\nPASSAGE>>>/.exec(user);
      if (match?.[1] === undefined || match[2] === undefined) {
        return Promise.resolve({
          response: JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null }),
        });
      }
      const sentence = /^[^.]+\./.exec(match[2])?.[0] ?? match[2].slice(0, 60);
      return Promise.resolve({
        response: JSON.stringify({
          found: true,
          chunkId: match[1],
          quotedSpan: sentence,
          rationale: "The passage describes the reaction.",
        }),
      });
    },
    aiGatewayLogId: "aig-test",
  };
  return { binding, prompts };
}

const base = {
  chunks: SEED_CHUNKS,
  documentKind: "ccds" as const,
  labelSetId: "spl-1",
  gateway: null,
  now: "2026-08-26T10:00:00Z",
  actor: "reviewer-demo",
  target: "SN-2026-000101",
};

describe("two calls per case, maximum", () => {
  it("calls the model once per namespace and not once per chunk", async () => {
    const { binding, prompts } = quotingBinding();
    await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null },
    });
    expect(prompts).toHaveLength(2);
  });

  it("puts every retrieved passage for a namespace into one prompt", async () => {
    const { binding, prompts } = quotingBinding();
    await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null },
    });
    // The company prompt carried more than one passage; had this been called
    // per chunk there would be one passage per prompt and four prompts.
    const passages = prompts.map((p) => p.split("<<<PASSAGE").length - 1);
    expect(Math.max(...passages)).toBeGreaterThan(1);
  });
});

describe("the two namespaces stay apart", () => {
  it("cites only company documents for listedness and only public for expectedness", async () => {
    const { binding } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      ai: { binding, reason: null },
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
      ai: { binding, reason: null },
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
      ai: { binding, reason: null },
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
      ai: { binding: null, reason: "generation is disabled by configuration" },
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
      ai: { binding: null, reason: "no binding" },
    });
    if (out.listedness.state === "grounded") {
      expect(out.listedness.reading.status).not.toBe("nothing_found");
    }
    expect(out.listedness.state).not.toBe("no_result");
  });
});

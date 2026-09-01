/**
 * The call, its one retry, and every way it is allowed to give up.
 *
 * The claim these exist to defend: a failure of any kind produces
 * `unavailable`, never `nothing_found`. "Nothing found" is a statement about a
 * document. A model that timed out has made no statement about anything, and
 * a reviewer who reads one as the other can start — or fail to start — a
 * 15-day regulatory clock on the strength of an outage.
 */
import { describe, expect, it, vi } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import { GENERATION_MODEL, messagesOf, type AiBinding } from "./ai";
import { readPassages } from "./generate";

const DOC = DocumentId.parse("00000001-0000-4000-8000-000000000001");

const CHUNK: DocumentChunk = {
  id: ChunkId.parse("ccds#1"),
  documentId: DOC,
  sourceType: "company",
  section: "4.8 Undesirable effects",
  ordinal: 1,
  text: "Elevations in hepatic transaminases have been reported. Jaundice has been reported rarely.",
  charStart: 0,
  charEnd: 88,
  tokenEstimate: 22,
};

const GOOD = JSON.stringify({
  found: true,
  chunkId: "P1",
  quotedSpan: "Jaundice has been reported rarely.",
  rationale: "The passage records jaundice as a rare event.",
});

const FABRICATED = JSON.stringify({
  found: true,
  chunkId: "P1",
  quotedSpan: "Fatal hepatic failure occurred in 3% of patients.",
  rationale: "The passage describes fatal hepatic failure.",
});

interface FakeCall {
  readonly model: string;
  readonly system: string;
  readonly user: string;
}

function fakeBinding(replies: readonly string[], logId: string | null = "aig-1") {
  const calls: FakeCall[] = [];
  let n = 0;
  const binding: AiBinding = {
    run: (model, input) => {
      const system = messagesOf(input).find((m) => m.role === "system")?.content ?? "";
      const user = messagesOf(input).find((m) => m.role === "user")?.content ?? "";
      calls.push({ model, system, user });
      const reply = replies[n] ?? replies[replies.length - 1] ?? "";
      n += 1;
      return Promise.resolve({ response: reply });
    },
    aiGatewayLogId: logId,
  };
  return { binding, calls };
}

const run = (binding: AiBinding | null, extra: { timeoutMs?: number } = {}) =>
  readPassages({
    binding,
    unavailableReason: "no Workers AI binding is configured in this environment",
    gateway: null,
    reactionTerm: "jaundice",
    drugName: "Hepalex",
    chunks: [CHUNK],
    now: "2026-08-26T10:00:00Z",
    ...extra,
  });

describe("when there is no model", () => {
  it("returns unavailable and makes no call", async () => {
    const out = await run(null);
    expect(out.reading.status).toBe("unavailable");
    expect(out.attempts).toHaveLength(0);
  });

  it("never returns nothing_found", async () => {
    const out = await run(null);
    expect(out.reading.status).not.toBe("nothing_found");
  });
});

describe("the happy path", () => {
  it("returns a verified reading from a single inference", async () => {
    const { binding, calls } = fakeBinding([GOOD]);
    const out = await run(binding);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(GENERATION_MODEL);
    expect(out.reading.status).toBe("read");
    if (out.reading.status === "read") {
      expect(out.reading.quotedSpan).toBe("Jaundice has been reported rarely.");
      expect(out.reading.gatewayRequestId).toBe("aig-1");
      expect(out.reading.model).toBe(GENERATION_MODEL);
    }
  });

  it("sends every retrieved passage in one prompt, not one call per chunk", async () => {
    const second: DocumentChunk = { ...CHUNK, id: ChunkId.parse("ccds#2"), ordinal: 2 };
    const { binding, calls } = fakeBinding([GOOD]);
    await readPassages({
      binding,
      unavailableReason: "n/a",
      gateway: null,
      reactionTerm: "jaundice",
      drugName: "Hepalex",
      chunks: [CHUNK, second],
      now: "2026-08-26T10:00:00Z",
    });
    expect(calls).toHaveLength(1);
    // Both passages, under the labels the model is asked to cite.
    expect(calls[0]?.user).toContain('id="P1"');
    expect(calls[0]?.user).toContain('id="P2"');
  });

  it("passes a found:false reply through as a reading, not a failure", async () => {
    const { binding } = fakeBinding([
      JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null }),
    ]);
    const out = await run(binding);
    expect(out.reading.status).toBe("nothing_found");
  });
});

describe("the one retry", () => {
  it("retries once with an instruction naming what was wrong", async () => {
    const { binding, calls } = fakeBinding(["not json at all", GOOD]);
    const out = await run(binding);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.system).toContain("YOUR PREVIOUS REPLY WAS REJECTED");
    expect(calls[1]?.system).toContain("not a JSON object");
    expect(out.reading.status).toBe("read");
  });

  it("stops after the second failure and never tries a third time", async () => {
    const { binding, calls } = fakeBinding(["nope", "still nope"]);
    const out = await run(binding);
    expect(calls).toHaveLength(2);
    expect(out.reading.status).toBe("unavailable");
  });

  it("tells the model exactly which check its quotation failed", async () => {
    const { binding, calls } = fakeBinding([FABRICATED, GOOD]);
    await run(binding);
    expect(calls[1]?.system).toContain("does not occur in ccds#1");
  });
});

describe("a fabricated quotation is never rendered", () => {
  it("degrades to unavailable rather than showing an invented span", async () => {
    const { binding } = fakeBinding([FABRICATED, FABRICATED]);
    const out = await run(binding);
    expect(out.reading.status).toBe("unavailable");
    if (out.reading.status === "unavailable") {
      expect(out.reading.reason).toContain("does not occur");
    }
  });

  it("does not fall back to nothing_found, which would be a claim", async () => {
    const { binding } = fakeBinding([FABRICATED, FABRICATED]);
    const out = await run(binding);
    expect(out.reading.status).not.toBe("nothing_found");
  });
});

describe("transport failure", () => {
  it("returns unavailable when the binding throws, without retrying", async () => {
    const binding: AiBinding = {
      run: () => Promise.reject(new Error("522 origin unreachable")),
      aiGatewayLogId: null,
    };
    const out = await readPassages({
      binding,
      unavailableReason: "n/a",
      gateway: null,
      reactionTerm: "jaundice",
      drugName: "Hepalex",
      chunks: [CHUNK],
      now: "2026-08-26T10:00:00Z",
    });
    expect(out.reading.status).toBe("unavailable");
    expect(out.attempts).toHaveLength(1);
    if (out.reading.status === "unavailable") {
      expect(out.reading.reason).toContain("522 origin unreachable");
    }
  });

  it("gives up on a hang rather than blocking the reviewer", async () => {
    const binding: AiBinding = {
      run: () => new Promise(() => {}),
      aiGatewayLogId: null,
    };
    const out = await run(binding, { timeoutMs: 20 });
    expect(out.reading.status).toBe("unavailable");
    if (out.reading.status === "unavailable") {
      expect(out.reading.reason).toContain("exceeded 20ms");
    }
  });

  it("returns unavailable when the runtime returns no text", async () => {
    const binding: AiBinding = {
      run: () => Promise.resolve({ unexpected: true }),
      aiGatewayLogId: null,
    };
    const out = await run(binding);
    expect(out.reading.status).toBe("unavailable");
  });
});

describe("the gateway", () => {
  it("forwards the gateway options and records the log id", async () => {
    const seen = vi.fn();
    const binding: AiBinding = {
      run: (_model, _input, options) => {
        seen(options);
        return Promise.resolve({ response: GOOD });
      },
      aiGatewayLogId: "aig-xyz",
    };
    const out = await readPassages({
      binding,
      unavailableReason: "n/a",
      gateway: { id: "sidenote", cacheTtlSeconds: 3600, skipCache: false },
      reactionTerm: "jaundice",
      drugName: "Hepalex",
      chunks: [CHUNK],
      now: "2026-08-26T10:00:00Z",
    });
    expect(seen).toHaveBeenCalledWith({
      gateway: { id: "sidenote", cacheTtl: 3600, skipCache: false },
    });
    if (out.reading.status === "read") {
      expect(out.reading.gatewayRequestId).toBe("aig-xyz");
    }
  });
});

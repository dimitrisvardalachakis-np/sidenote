/**
 * Step 9: both calls go through AI Gateway, and the audit line ties a verdict
 * to the exact inference that informed it.
 */
import { describe, expect, it } from "vitest";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { DrugId, type SuspectDrug } from "@/lib/schemas";
import { assessCase } from "./assess";
import { extractReport } from "@/lib/extract/extract";
import { GATEWAY_CACHE_TTL_SECONDS, resolveGateway, type AiBinding } from "./ai";
import { documentsForDrug } from "./scope";

const HEPALEX: SuspectDrug = {
  id: DrugId.parse("00000002-0000-4000-8000-000000000001"),
  reportedName: "Hepalex",
  activeSubstance: "hepalexin",
  role: "suspect",
  marketingStatus: "marketed",
  dose: null,
  route: null,
  indication: null,
  therapyStart: null,
  therapyEnd: null,
  dechallenge: null,
  rechallenge: null,
};

const NOTHING_FOUND = JSON.stringify({
  found: false,
  chunkId: null,
  quotedSpan: null,
  rationale: null,
});

function recordingBinding(logId: string | null = "aig-log-42") {
  const options: unknown[] = [];
  const binding: AiBinding = {
    run: (_model, _input, opts) => {
      options.push(opts);
      return Promise.resolve({ response: NOTHING_FOUND });
    },
    aiGatewayLogId: logId,
  };
  return { binding, options };
}

describe("reading the gateway from the environment", () => {
  it("is configured when an id is present", () => {
    const g = resolveGateway({ SIDENOTE_AI_GATEWAY_ID: "sidenote" });
    expect(g).toEqual({
      id: "sidenote",
      cacheTtlSeconds: GATEWAY_CACHE_TTL_SECONDS,
      skipCache: false,
    });
  });

  it("caches for an hour by default", () => {
    // Long enough that two reviewers working one case over a morning see the
    // same reading — which is the point, not the saving.
    expect(GATEWAY_CACHE_TTL_SECONDS).toBe(3600);
  });

  it("can be told to skip the cache", () => {
    const g = resolveGateway({
      SIDENOTE_AI_GATEWAY_ID: "sidenote",
      SIDENOTE_AI_GATEWAY_SKIP_CACHE: "1",
    });
    expect(g?.skipCache).toBe(true);
  });

  it("is null when unset, and null means call directly rather than not at all", () => {
    expect(resolveGateway({})).toBeNull();
    expect(resolveGateway({ SIDENOTE_AI_GATEWAY_ID: "  " })).toBeNull();
  });
});

describe("both calls are routed through it", () => {
  it("passes gateway options on every assessment call", async () => {
    const { binding, options } = recordingBinding();
    await assessCase({
      chunks: SEED_CHUNKS,
      documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: "spl-1",
      ai: { binding, reason: null },
      gateway: resolveGateway({ SIDENOTE_AI_GATEWAY_ID: "sidenote" }),
      now: "2026-08-26T10:00:00Z",
      actor: "reviewer-demo",
      target: "SN-2026-000101",
    });
    expect(options.length).toBe(2); // one per namespace
    for (const o of options) {
      expect(o).toEqual({
        gateway: { id: "sidenote", cacheTtl: 3600, skipCache: false },
      });
    }
  });

  it("passes gateway options on the extraction call", async () => {
    const options: unknown[] = [];
    const binding: AiBinding = {
      run: (_m, _i, opts) => {
        options.push(opts);
        return Promise.resolve({ response: "not json" });
      },
      aiGatewayLogId: "aig-1",
    };
    await extractReport({
      binding,
      unavailableReason: "n/a",
      gateway: resolveGateway({ SIDENOTE_AI_GATEWAY_ID: "sidenote" }),
      sourceText: "She went yellow.",
      knownProducts: [],
      now: "2026-08-26T10:00:00Z",
    });
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toEqual({
      gateway: { id: "sidenote", cacheTtl: 3600, skipCache: false },
    });
  });
});

describe("the spend ceiling is bounded by construction", () => {
  it("cannot exceed four inferences for one assessment", async () => {
    // Two namespaces, at most one retry each. A dashboard budget catches a
    // runaway late; a bounded retry count prevents one outright.
    let calls = 0;
    const binding: AiBinding = {
      run: () => {
        calls += 1;
        return Promise.resolve({ response: "never valid json" });
      },
      aiGatewayLogId: null,
    };
    await assessCase({
      chunks: SEED_CHUNKS,
      documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
      reactionTerm: "liver failure, died",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: "spl-1",
      ai: { binding, reason: null },
      gateway: null,
      now: "2026-08-26T10:00:00Z",
      actor: "reviewer-demo",
      target: "SN-2026-000101",
    });
    expect(calls).toBeLessThanOrEqual(4);
  });
});

describe("the audit line ties a verdict to its inference", () => {
  /** Capture [AUDIT] lines without letting them reach the test output. */
  function captureAudit(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.startsWith("[AUDIT]")) lines.push(text);
      else original(...args);
    };
    return { lines, restore: () => { console.log = original; } };
  }

  it("records the model and the gateway request id, and parses as one line of JSON", async () => {
    const { binding } = recordingBinding("aig-log-42");
    const capture = captureAudit();
    try {
      await assessCase({
        chunks: SEED_CHUNKS,
        documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
        reactionTerm: "liver failure, died",
        drugName: "Hepalex",
        documentKind: "ccds",
        labelSetId: "spl-1",
        ai: { binding, reason: null },
        gateway: resolveGateway({ SIDENOTE_AI_GATEWAY_ID: "sidenote" }),
        now: "2026-08-26T10:00:00Z",
        actor: "reviewer-demo",
        target: "SN-2026-000101",
      });
    } finally {
      capture.restore();
    }

    expect(capture.lines.length).toBe(2);
    const line = capture.lines[0] ?? "";
    expect(line.includes("\n")).toBe(false); // single line, or a shipper splits it

    const record: unknown = JSON.parse(line.slice("[AUDIT] ".length));
    expect(record).toMatchObject({
      actor: "reviewer-demo",
      action: "generate_reading",
      target: "SN-2026-000101",
      outcome: "success",
      detail: {
        model: "@cf/meta/llama-3.1-8b-instruct",
        gatewayRequestId: "aig-log-42",
        gateway: "sidenote",
      },
    });
    // The five fields non-negotiable #9 requires, all present.
    for (const key of ["actor", "action", "target", "timestamp", "outcome"]) {
      expect(record).toHaveProperty(key);
    }
  });

  it("says 'none' rather than lying when no gateway is configured", async () => {
    const { binding } = recordingBinding(null);
    const capture = captureAudit();
    try {
      await assessCase({
        chunks: SEED_CHUNKS,
        documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
        reactionTerm: "liver failure, died",
        drugName: "Hepalex",
        documentKind: "ccds",
        labelSetId: "spl-1",
        ai: { binding, reason: null },
        gateway: null,
        now: "2026-08-26T10:00:00Z",
        actor: "reviewer-demo",
        target: "SN-2026-000101",
      });
    } finally {
      capture.restore();
    }
    const record = JSON.parse((capture.lines[0] ?? "").slice("[AUDIT] ".length)) as {
      detail: { gateway: string; gatewayRequestId: string };
    };
    expect(record.detail.gateway).toBe("none");
    expect(record.detail.gatewayRequestId).toBe("none");
  });

  it("records a failure as a failure, with the reason recoverable", async () => {
    const binding: AiBinding = {
      run: () => Promise.reject(new Error("522 origin unreachable")),
      aiGatewayLogId: null,
    };
    const capture = captureAudit();
    try {
      await assessCase({
        chunks: SEED_CHUNKS,
        documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
        reactionTerm: "liver failure, died",
        drugName: "Hepalex",
        documentKind: "ccds",
        labelSetId: "spl-1",
        ai: { binding, reason: null },
        gateway: null,
        now: "2026-08-26T10:00:00Z",
        actor: "reviewer-demo",
        target: "SN-2026-000101",
      });
    } finally {
      capture.restore();
    }
    const record = JSON.parse((capture.lines[0] ?? "").slice("[AUDIT] ".length)) as {
      outcome: string;
      detail: { status: string };
    };
    expect(record.outcome).toBe("failure");
    expect(record.detail.status).toBe("unavailable");
  });
});

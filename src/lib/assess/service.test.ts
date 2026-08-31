import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentChunk } from "@/lib/schemas";
import type { AssessInput, AssessOutput } from "./assess";
import { ASSESS_ROUTE, ASSESS_SECRET_HEADER } from "./wire";

/**
 * The seam between this app and the Worker that does the reading.
 *
 * What is worth pinning here is not that a fetch happens — it is the three
 * things that make the boundary safe to have at all: the secret genuinely
 * travels, a reply is not trusted because it arrived, and the seam itself can
 * never be what breaks the case screen.
 *
 * The Worker is not exercised end to end anywhere. A `services` binding needs
 * two deployed Workers, so what is tested is this side of it against a
 * stand-in Fetcher.
 */
const env = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/platform/env", () => ({
  getCloudflareEnv: async () => env.value,
}));

const { assessThroughService, getAssessService } = await import("./service");

/** A chunk with a sentence a reply can quote, correctly or otherwise. */
const CHUNK = {
  id: "11111111-1111-4111-8111-111111111111",
  documentId: "22222222-2222-4222-8222-222222222222",
  sourceType: "company",
  section: "4.8 Undesirable effects",
  ordinal: 0,
  text: "Transaminase elevation has been reported in a small number of patients.",
  charStart: 0,
  charEnd: 71,
  tokenEstimate: 14,
} as unknown as DocumentChunk;

const INPUT: AssessInput = {
  chunks: [CHUNK],
  documentIds: new Set(["22222222-2222-4222-8222-222222222222"]),
  reactionTerm: "hepatic failure",
  drugName: "Hepalex",
  documentKind: "ccds",
  labelSetId: null,
  ai: { binding: null, reason: "no model configured", source: "none" },
  gateway: null,
  now: "2026-08-25T10:00:00.000Z",
  actor: "reviewer-demo",
  target: "SN-2026-000101",
} as unknown as AssessInput;

/** What a well-behaved Worker returns for this input with no model reachable. */
const DEGRADED: AssessOutput = {
  listedness: {
    state: "source_unavailable",
    documentKind: "ccds",
    reason: "no model configured",
    attemptedAt: "2026-08-25T10:00:00.000Z",
  },
  expectedness: {
    state: "source_unavailable",
    reason: "no public label is held for this product",
    attemptedAt: "2026-08-25T10:00:00.000Z",
  },
} as unknown as AssessOutput;

/** What was actually sent, rather than the Request object that sent it. */
interface Sent {
  readonly method: string;
  readonly path: string;
  readonly secret: string | null;
  readonly body: { documentIds: string[]; reactionTerm: string };
}

function binding(reply: () => Response) {
  const seen: Sent[] = [];
  return {
    seen,
    fetch: async (request: Request) => {
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname,
        secret: request.headers.get(ASSESS_SECRET_HEADER),
        body: (await request.json()) as Sent["body"],
      });
      return reply();
    },
  };
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  env.value = null;
  vi.restoreAllMocks();
});

/** Audit lines are the only record of a silent fallback; keep them quiet. */
function hushAudit(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
}

describe("choosing where the RAG path runs", () => {
  it("runs in-process when there is no binding", async () => {
    expect((await getAssessService()).remote).toBe(false);
  });

  it("runs in-process when the binding is there but the secret is not", async () => {
    hushAudit();
    env.value = { ASSESS: binding(() => ok(DEGRADED)) };

    // Calling an authenticated Worker without credentials would fail on the
    // far side. A local call that works beats a remote call that cannot.
    expect((await getAssessService()).remote).toBe(false);
  });

  it("uses the binding when both are there", async () => {
    env.value = {
      ASSESS: binding(() => ok(DEGRADED)),
      SIDENOTE_ASSESS_SECRET: "s3cret",
    };

    expect((await getAssessService()).remote).toBe(true);
  });
});

describe("what crosses the boundary", () => {
  it("sends the secret in the header the Worker checks", async () => {
    const bound = binding(() => ok(DEGRADED));
    env.value = { ASSESS: bound, SIDENOTE_ASSESS_SECRET: "s3cret" };

    await assessThroughService(INPUT);

    const sent = bound.seen[0];
    expect(sent?.secret).toBe("s3cret");
    expect(sent?.method).toBe("POST");
    expect(sent?.path).toBe(ASSESS_ROUTE);
  });

  it("sends the scoped document ids, so the far side cannot widen them", async () => {
    const bound = binding(() => ok(DEGRADED));
    env.value = { ASSESS: bound, SIDENOTE_ASSESS_SECRET: "s3cret" };

    await assessThroughService(INPUT);

    expect(bound.seen[0]?.body.documentIds).toEqual([
      "22222222-2222-4222-8222-222222222222",
    ]);
  });
});

describe("a reply is not trusted because it arrived", () => {
  it("falls back when the Worker quotes a span that is not in the chunk", async () => {
    hushAudit();
    const fabricated = {
      listedness: {
        state: "grounded",
        documentKind: "ccds",
        citations: [
          {
            chunkId: CHUNK.id,
            documentId: CHUNK.documentId,
            sourceType: "company",
            section: CHUNK.section,
            quotedSpan: "fulminant hepatic failure was observed",
          },
        ],
        reading: {
          status: "read",
          chunkId: CHUNK.id,
          // Never appears in CHUNK.text. Non-negotiable #6 is a property of
          // the system, not of the process that generated the sentence.
          quotedSpan: "fulminant hepatic failure was observed",
          rationale: null,
          model: "@cf/meta/llama-3.1-8b-instruct",
          gatewayRequestId: null,
          generatedAt: "2026-08-25T10:00:00.000Z",
        },
        narrative: null,
        retrievedAt: "2026-08-25T10:00:00.000Z",
      },
      expectedness: DEGRADED.expectedness,
    };

    env.value = {
      ASSESS: binding(() => ok(fabricated)),
      SIDENOTE_ASSESS_SECRET: "s3cret",
    };

    const out = await assessThroughService(INPUT);

    // Discarded whole and recomputed here, never trimmed until it matched.
    expect(out.listedness.state).not.toBe("grounded");
  });

  it("falls back on a shape it cannot render", async () => {
    hushAudit();
    env.value = {
      ASSESS: binding(() => ok({ listedness: "yes", expectedness: "no" })),
      SIDENOTE_ASSESS_SECRET: "s3cret",
    };

    const out = await assessThroughService(INPUT);
    // Whatever the local path concludes, it concluded it from the documents.
    // What must never survive is the remote finding.
    expect(out.listedness.state).not.toBe("grounded");
  });

  it("falls back on an error status rather than breaking the screen", async () => {
    hushAudit();
    env.value = {
      ASSESS: binding(() => ok({ error: "unauthorized" }, 401)),
      SIDENOTE_ASSESS_SECRET: "wrong",
    };

    // Non-negotiable #8, one layer out: a second Worker being down makes an
    // assessment slower, not a case screen broken. It resolves rather than
    // throwing, and what comes back is the local reading of the same passages.
    const out = await assessThroughService(INPUT);
    expect(out.listedness.state).not.toBe("grounded");
    expect(out.expectedness.state).not.toBe("grounded");
  });

  it("passes a well-formed reply straight through", async () => {
    env.value = {
      ASSESS: binding(() => ok(DEGRADED)),
      SIDENOTE_ASSESS_SECRET: "s3cret",
    };

    const out = await assessThroughService(INPUT);
    expect(out.listedness.state).toBe("source_unavailable");
    expect(out.expectedness.state).toBe("source_unavailable");
  });
});

/**
 * The narrative where it meets the rest of the system.
 *
 * Three claims, in order of how expensive they would be to get wrong:
 *
 *   1. ADDITIVITY. A narrative that fails changes nothing else about a
 *      finding. This is non-negotiable #8 at the level the feature touches,
 *      and it is asserted by deep-equalling two findings rather than by
 *      inspecting fields one at a time — a field added later is covered
 *      automatically.
 *   2. THE GATE. No narrative call is made unless the reading succeeded.
 *   3. THE CEILING. The worst case is what `MAX_CALLS_PER_ASSESSMENT` says.
 */
import { describe, expect, it } from "vitest";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import {
  DrugId,
  ListednessFinding,
  type Citation,
  type SuspectDrug,
} from "@/lib/schemas";
import { assessCase } from "./assess";
import { answerPublicQuestion } from "./answer";
import { documentsForDrug } from "./scope";
import {
  MAX_CALLS_PER_ASSESSMENT,
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

const base = {
  chunks: SEED_CHUNKS,
  documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
  documentKind: "ccds" as const,
  labelSetId: "spl-1",
  gateway: null,
  now: "2026-08-26T10:00:00Z",
  actor: "reviewer-demo",
  target: "SN-2026-000101",
  reactionTerm: "liver failure, died",
  drugName: "Hepalex",
};

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

const firstSentence = (text: string) =>
  /^[^.]+\./.exec(text)?.[0] ?? text.slice(0, 60);

type ReadingMode = "quote" | "nothing_found" | "garbage";

/**
 * A binding whose reading behaviour and narrative behaviour are set
 * independently, so the gate and additivity can each be exercised on their own.
 */
function binding(mode: ReadingMode, narrativeReply: "good" | "garbage") {
  const readingCalls: string[] = [];
  const narrativeCalls: string[] = [];

  const b: AiBinding = {
    run: (_model, input) => {
      const messages = messagesOf(input);
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const passages = passagesIn(user);

      if (system.includes('"points"')) {
        narrativeCalls.push(user);
        if (narrativeReply === "garbage") {
          return Promise.resolve({ response: "this is not json" });
        }
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

      readingCalls.push(user);
      if (mode === "nothing_found") {
        return Promise.resolve({
          response: JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null }),
        });
      }
      if (mode === "garbage") {
        return Promise.resolve({ response: "not json either" });
      }
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
  return { binding: b, readingCalls, narrativeCalls };
}

const ai = (b: AiBinding) => ({ binding: b, reason: null, source: "http" as const });

describe("the narrative reaches the finding", () => {
  it("attaches a narrated narrative to a grounded finding that parses", async () => {
    const { binding: b } = binding("quote", "good");
    const out = await assessCase({ ...base, ai: ai(b) });
    expect(out.listedness.state).toBe("grounded");
    if (out.listedness.state !== "grounded") return;
    expect(out.listedness.narrative?.status).toBe("narrated");
    expect(ListednessFinding.safeParse(out.listedness).success).toBe(true);
  });

  /*
    The second lock. `verifyNarrative` already refuses a chunk id it was not
    sent, so this rule only bites on an Assessment parsed from somewhere else —
    a stored row, a queue message, a fixture. That is exactly why it is worth
    having.
  */
  it("refuses a stored finding whose narrative cites a passage not retrieved with it", () => {
    const citation: Citation = {
      chunkId: "ccds-7.2#41" as Citation["chunkId"],
      documentId: "00000001-0000-4000-8000-000000000001" as Citation["documentId"],
      sourceType: "company",
      section: "4.8",
      quote: "Jaundice has been reported rarely.",
    };
    const result = ListednessFinding.safeParse({
      state: "grounded",
      documentKind: "ccds",
      citations: [citation],
      reading: {
        status: "read",
        chunkId: "ccds-7.2#41",
        quotedSpan: "Jaundice has been reported rarely.",
        rationale: null,
        model: "m",
        gatewayRequestId: null,
        generatedAt: "2026-08-26T10:00:00Z",
      },
      narrative: {
        status: "narrated",
        points: [
          {
            chunkId: "ccds-7.2#99",
            quotedSpan: "Something from a passage nobody retrieved.",
            sentence: "The passage says something.",
          },
        ],
        model: "m",
        gatewayRequestId: null,
        generatedAt: "2026-08-26T10:00:00Z",
      },
      retrievedAt: "2026-08-26T10:00:00Z",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) => i.path.join(".") === "narrative.points",
      ),
    ).toBe(true);
  });
});

describe("the gate: no narrative without a reading", () => {
  it("makes no narrative call when the reading found nothing", async () => {
    const { binding: b, readingCalls, narrativeCalls } = binding("nothing_found", "good");
    const out = await assessCase({ ...base, ai: ai(b) });
    expect(readingCalls.length).toBeGreaterThan(0);
    expect(narrativeCalls).toHaveLength(0);
    if (out.listedness.state !== "grounded") return;
    expect(out.listedness.narrative).toBeNull();
  });

  it("makes no narrative call when the reading is unavailable", async () => {
    const { binding: b, narrativeCalls } = binding("garbage", "good");
    const out = await assessCase({ ...base, ai: ai(b) });
    expect(narrativeCalls).toHaveLength(0);
    if (out.listedness.state !== "grounded") return;
    expect(out.listedness.narrative).toBeNull();
    // And the reading itself still degrades honestly.
    expect(out.listedness.reading.status).toBe("unavailable");
  });

  it("stays within the declared ceiling in the worst case", async () => {
    const { binding: b, readingCalls, narrativeCalls } = binding("garbage", "garbage");
    await assessCase({ ...base, ai: ai(b) });
    expect(readingCalls.length + narrativeCalls.length).toBeLessThanOrEqual(
      MAX_CALLS_PER_ASSESSMENT,
    );
  });
});

describe("additivity", () => {
  /*
    THE claim. Run the same assessment twice against identical retrieval, once
    with a narrative that works and once with one that returns garbage, then
    compare the findings with `narrative` removed. Everything else — the state,
    the citations, the reading, the document kind, the timestamps — must be
    identical. A field added to a finding later is covered without touching
    this test.
  */
  it("a failed narrative changes nothing else about the findings", async () => {
    const good = await assessCase({ ...base, ai: ai(binding("quote", "good").binding) });
    const bad = await assessCase({ ...base, ai: ai(binding("quote", "garbage").binding) });

    const withoutNarrative = (finding: Record<string, unknown>) => {
      const { narrative: _narrative, ...rest } = finding;
      return rest;
    };

    expect(withoutNarrative(good.listedness)).toEqual(
      withoutNarrative(bad.listedness),
    );
    expect(withoutNarrative(good.expectedness)).toEqual(
      withoutNarrative(bad.expectedness),
    );

    // And the two narratives really did differ, or the comparison proved nothing.
    if (good.listedness.state !== "grounded" || bad.listedness.state !== "grounded") {
      throw new Error("expected both runs to be grounded");
    }
    expect(good.listedness.narrative?.status).toBe("narrated");
    expect(bad.listedness.narrative?.status).toBe("unavailable");
  });
});

describe("the public answer", () => {
  it("returns a null narrative when the question is too short to search", async () => {
    const out = await answerPublicQuestion("a", SEED_CHUNKS, {
      ai: { binding: binding("quote", "good").binding, reason: null, source: "http" },
      dense: null,
      gateway: null,
    });
    expect(out.narrative).toBeNull();
    expect(out.reading).toBeNull();
  });

  it("returns a null narrative when nothing is in scope", async () => {
    const out = await answerPublicQuestion(
      "muscle pain",
      SEED_CHUNKS,
      {
        ai: { binding: binding("quote", "good").binding, reason: null, source: "http" },
        dense: null,
        gateway: null,
      },
      new Set(),
    );
    expect(out.narrative).toBeNull();
  });

  /*
    The confidentiality boundary, extended to the new field. A narrative point
    citing a company chunk on the public search would leak CCDS text to an
    anonymous visitor — the one failure this surface must never have.
  */
  it("never produces a narrative point citing a company passage", async () => {
    const { binding: b } = binding("quote", "good");
    const out = await answerPublicQuestion("rash", SEED_CHUNKS, {
      ai: { binding: b, reason: null, source: "http" },
      dense: null,
      gateway: null,
    });
    if (out.narrative?.status !== "narrated") return;
    const publicIds = new Set(
      SEED_CHUNKS.filter((c) => c.sourceType === "public").map((c) => c.id),
    );
    for (const point of out.narrative.points) {
      expect(publicIds.has(point.chunkId)).toBe(true);
    }
  });
});

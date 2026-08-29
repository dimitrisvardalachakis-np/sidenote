/**
 * The narrative call: one attempt, its ceiling, and every way it gives up.
 *
 * The claim this file defends is the same one `generate.test.ts` defends, and
 * it matters more here rather than less: a failure of any kind produces
 * `unavailable`. A narrative has no state that can say a document is silent,
 * so there is nothing for a failure to be mistaken for — but the WORDING of
 * each reason still has to stay a statement about the model's reply and never
 * about the document, and that is asserted rather than assumed.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import {
  GENERATION_MODEL,
  MAX_NARRATIVE_ATTEMPTS,
  MAX_OUTPUT_TOKENS,
  NARRATIVE_MAX_OUTPUT_TOKENS,
  messagesOf,
  type AiBinding,
  type TextGenerationInput,
} from "./ai";
import { narratePassages } from "./generate";
import { buildMessages, buildUserMessage } from "./prompt";

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

const SECOND: DocumentChunk = {
  ...CHUNK,
  id: ChunkId.parse("ccds#2"),
  ordinal: 2,
  text: "Headache and nausea were the most frequently reported adverse reactions.",
};

const GOOD = JSON.stringify({
  points: [
    {
      chunkId: "ccds#1",
      quotedSpan: "Jaundice has been reported rarely.",
      sentence: "The passage records jaundice as an uncommon occurrence.",
    },
    {
      chunkId: "ccds#2",
      quotedSpan: "Headache and nausea were the most frequently reported adverse reactions.",
      sentence: "The passage names headache and nausea as the most frequent.",
    },
  ],
});

interface FakeCall {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number | undefined;
}

function fakeBinding(replies: readonly string[], logId: string | null = "aig-1") {
  const calls: FakeCall[] = [];
  let n = 0;
  const binding: AiBinding = {
    run: (model, input: TextGenerationInput) => {
      const messages = messagesOf(input);
      calls.push({
        model,
        system: messages.find((m) => m.role === "system")?.content ?? "",
        user: messages.find((m) => m.role === "user")?.content ?? "",
        maxTokens: input.max_tokens,
      });
      const reply = replies[n] ?? replies[replies.length - 1] ?? "";
      n += 1;
      return Promise.resolve({ response: reply });
    },
    aiGatewayLogId: logId,
  };
  return { binding, calls };
}

const run = (
  binding: AiBinding | null,
  extra: { timeoutMs?: number; chunks?: readonly DocumentChunk[] } = {},
) => {
  const { chunks = [CHUNK, SECOND], ...rest } = extra;
  return narratePassages({
    binding,
    unavailableReason: "no Workers AI binding is configured in this environment",
    gateway: null,
    reactionTerm: "jaundice",
    drugName: "Hepalex",
    chunks,
    now: "2026-08-26T10:00:00Z",
    ...rest,
  });
};

describe("the happy path", () => {
  it("returns the verified points", async () => {
    const { binding, calls } = fakeBinding([GOOD]);
    const out = await run(binding);
    expect(out.narrative.status).toBe("narrated");
    if (out.narrative.status !== "narrated") return;
    expect(out.narrative.points).toHaveLength(2);
    expect(out.narrative.model).toBe(GENERATION_MODEL);
    expect(out.narrative.gatewayRequestId).toBe("aig-1");
    expect(calls).toHaveLength(1);
  });

  /*
    Requirement 6, asserted rather than commented. The narrative needs a bigger
    output budget than a single quotation, and it must NOT get there by raising
    the constant the reading path and lib/extract share.
  */
  it("uses its own output ceiling, not the shared one", async () => {
    const { binding, calls } = fakeBinding([GOOD]);
    await run(binding);
    expect(calls[0]?.maxTokens).toBe(NARRATIVE_MAX_OUTPUT_TOKENS);
    expect(calls[0]?.maxTokens).not.toBe(MAX_OUTPUT_TOKENS);
  });

  /*
    The sanitisation claim. The narrative does not build its own user message —
    it reuses `buildUserMessage`, so the passage fence and every
    `sanitisePassage` call are inherited rather than duplicated. Byte equality
    with the reading path's user message is what proves there is no second copy
    that could drift.
  */
  it("sends a user message byte-identical to the reading path's", async () => {
    const { binding, calls } = fakeBinding([GOOD]);
    await run(binding);
    const expected = buildUserMessage({
      reactionTerm: "jaundice",
      drugName: "Hepalex",
      chunks: [CHUNK, SECOND],
    });
    expect(calls[0]?.user).toBe(expected);
    const readingUser = buildMessages(
      { reactionTerm: "jaundice", drugName: "Hepalex", chunks: [CHUNK, SECOND] },
      null,
    )[1]?.content;
    expect(calls[0]?.user).toBe(readingUser);
  });

  it("accepts a reply wrapped in a markdown fence", async () => {
    const { binding } = fakeBinding(["```json\n" + GOOD + "\n```"]);
    const out = await run(binding);
    expect(out.narrative.status).toBe("narrated");
  });
});

describe("every failure produces unavailable", () => {
  it("returns unavailable and makes no call when there is no binding", async () => {
    const { calls } = fakeBinding([GOOD]);
    const out = await run(null);
    expect(out.narrative.status).toBe("unavailable");
    expect(out.narrative.model).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns unavailable and makes no call when there are no passages", async () => {
    const { binding, calls } = fakeBinding([GOOD]);
    const out = await run(binding, { chunks: [] });
    expect(out.narrative.status).toBe("unavailable");
    expect(calls).toHaveLength(0);
  });

  it("returns unavailable on a timeout", async () => {
    const binding: AiBinding = {
      run: () => new Promise(() => {}),
      aiGatewayLogId: "aig-hang",
    };
    const out = await run(binding, { timeoutMs: 5 });
    expect(out.narrative.status).toBe("unavailable");
    if (out.narrative.status !== "unavailable") return;
    expect(out.narrative.reason).toMatch(/could not be reached/);
  });

  /*
    THE cost claim. The narrative gets one attempt and one stricter retry, so a
    malformed reply costs exactly two inferences and never more.
  */
  it("spends exactly two inferences on a persistently malformed reply", async () => {
    const { binding, calls } = fakeBinding(["not json at all"]);
    const out = await run(binding);
    expect(out.narrative.status).toBe("unavailable");
    expect(calls).toHaveLength(MAX_NARRATIVE_ATTEMPTS);
    expect(out.attempts).toHaveLength(MAX_NARRATIVE_ATTEMPTS);
  });

  /*
    The retry is what makes the feature work against a real 8B model, which
    answers the first attempt in prose often enough that a single attempt meant
    the narrative never rendered at all.
  */
  it("recovers when the retry returns valid JSON", async () => {
    const { binding, calls } = fakeBinding(["Sure! Here are the points:", GOOD]);
    const out = await run(binding);
    expect(out.narrative.status).toBe("narrated");
    expect(calls).toHaveLength(2);
  });

  it("names the specific failure in the retry rather than saying try again", async () => {
    const { binding, calls } = fakeBinding(["not json at all", GOOD]);
    await run(binding);
    const retrySystem = calls[1]?.system ?? "";
    expect(retrySystem).toContain("YOUR PREVIOUS REPLY WAS REJECTED.");
    expect(retrySystem).toContain("the reply was not a JSON object");
    /*
      And it names ITS OWN fallback. Reusing the single-reading retry would
      instruct the model to answer `{"found": false, ...}`, a shape this parser
      is guaranteed to reject — a bug that would look like reuse.
    */
    expect(retrySystem).toContain('{"points": []}');
    expect(retrySystem).not.toContain('"found"');
  });

  it("does not retry a transport failure", async () => {
    let calls = 0;
    const binding: AiBinding = {
      run: () => {
        calls += 1;
        return Promise.reject(new Error("socket hang up"));
      },
      aiGatewayLogId: null,
    };
    const out = await run(binding);
    expect(out.narrative.status).toBe("unavailable");
    // Sending a stricter instruction to a model that did not answer is pointless.
    expect(calls).toBe(1);
  });

  it("spends both inferences when no point survives", async () => {
    const fabricated = JSON.stringify({
      points: [
        {
          chunkId: "ccds#1",
          quotedSpan: "Fatal hepatic failure occurred in 3% of patients.",
          sentence: "The passage describes hepatic failure.",
        },
      ],
    });
    const { binding, calls } = fakeBinding([fabricated]);
    const out = await run(binding);
    expect(out.narrative.status).toBe("unavailable");
    expect(calls).toHaveLength(MAX_NARRATIVE_ATTEMPTS);
    expect(out.dropped.map((d) => d.reason)).toEqual(["span_not_verbatim"]);
  });

  /*
    No reason string may read as a claim about what the documents contain.
    "None of the points could be verified" is a fact about a model reply;
    "the label does not mention this" would be a finding, and this function is
    in no position to make one.
  */
  it("never words a failure as a statement about the documents", async () => {
    for (const reply of ["not json", '{"points":[]}', '{"wrong":1}']) {
      const { binding } = fakeBinding([reply]);
      const out = await run(binding);
      expect(out.narrative.status).toBe("unavailable");
      if (out.narrative.status !== "unavailable") continue;
      expect(out.narrative.reason).not.toMatch(
        /does not mention|is silent|nothing found|no mention/i,
      );
    }
  });

  it("keeps the gateway log id on a failure, so the inference is still traceable", async () => {
    const { binding } = fakeBinding(["not json"], "aig-failed");
    const out = await run(binding);
    expect(out.narrative.gatewayRequestId).toBe("aig-failed");
  });
});

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
import {
  GENERATION_TIMEOUT_MS,
  NARRATIVE_TIMEOUT_MS,
  narratePassages,
} from "./generate";
import {
  NARRATIVE_MAX_POINTS,
  NARRATIVE_POINT_MAX_CHARS,
} from "@/lib/schemas/narrative";
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
      // The label the passage was offered under, not its id. See `passageLabel`.
      chunkId: "P1",
      quotedSpan: "Jaundice has been reported rarely.",
      sentence: "The passage records jaundice as an uncommon occurrence.",
    },
    {
      chunkId: "P2",
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
          chunkId: "P1",
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


/*
  THE ARITHMETIC, AS AN EXECUTABLE CLAIM.

  The narrative could not finish inside its own timeout, and that was not
  flakiness — it was a sum nobody had done. `NARRATIVE_MAX_OUTPUT_TOKENS` was
  700 while `GENERATION_TIMEOUT_MS` was 10s, and the model decodes at about
  63 ms per output token. 700 tokens is 44 seconds. Every narrative on every
  screen rendered "the model could not be reached", and every layer below
  degraded exactly as designed, so nothing anywhere said the number was
  impossible.

  Four constants have to agree for a narrative to appear at all, and they live
  in three files: the point count and the per-point length in
  schemas/narrative.ts, the output ceiling in ai.ts, the timeout in generate.ts.
  Nothing connected them. This does.
*/
describe("the reply the contract permits has to fit inside the timeout", () => {
  /**
   * MEASURED against @cf/meta/llama-3.1-8b-instruct-fp8 through the gateway
   * with caching off, not estimated: runs came in at 56-74 ms per output
   * token. 63 is the middle of that and the figure the AI Gateway logs give.
   */
  const MS_PER_OUTPUT_TOKEN = 63;
  /** The usual working figure for English prose. */
  const CHARS_PER_TOKEN = 4;
  /** What the prompt asks a quoted span to stay under. */
  const SPAN_CHARS = 80;
  /** "P1" — the whole reason `passageLabel` exists. A uuid id cost ~25. */
  const LABEL_TOKENS = 2;
  /** `{"chunkId":"","quotedSpan":"","sentence":""},` and its punctuation. */
  const PER_POINT_SCAFFOLD = 12;
  /** `{"points":[ ... ]}` */
  const ENVELOPE_TOKENS = 8;

  const worstCaseTokens =
    ENVELOPE_TOKENS +
    NARRATIVE_MAX_POINTS *
      (LABEL_TOKENS +
        PER_POINT_SCAFFOLD +
        Math.ceil(SPAN_CHARS / CHARS_PER_TOKEN) +
        Math.ceil(NARRATIVE_POINT_MAX_CHARS / CHARS_PER_TOKEN));

  it("decodes the longest permitted reply inside NARRATIVE_TIMEOUT_MS", () => {
    expect(worstCaseTokens * MS_PER_OUTPUT_TOKEN).toBeLessThan(
      NARRATIVE_TIMEOUT_MS,
    );
  });

  /*
    And it needs a bigger budget than a reading, which is not a workaround.

    A reading reports one passage; a narrative reports two, and two is the
    whole reason it exists beside one. So it emits roughly twice the tokens and
    it costs roughly twice the time — at the same rate, doing the work that was
    asked for. Ten seconds was the reading's number applied to a different job.

    Asserted so that anybody collapsing the two back into one constant has to
    decide what the narrative should stop doing.
  */
  it("has a longer budget than the single reading, and says why in the constant", () => {
    expect(NARRATIVE_TIMEOUT_MS).toBeGreaterThan(GENERATION_TIMEOUT_MS);
  });

  /*
    The measured rate is the LOCAL one. The deployed native binding is slower —
    ~11s against ~4s for an identical call — so the margin between the modelled
    worst case and the budget is not slack, it is the gap between the two
    runtimes. Two points at ~110 tokens have to fit on the slow one.
  */
  it("leaves room for the deployed binding, not just the local client", () => {
    const modelled = worstCaseTokens * MS_PER_OUTPUT_TOKEN;
    expect(NARRATIVE_TIMEOUT_MS / modelled).toBeGreaterThan(1.8);
  });

  /*
    The other half, and the one that cost an extra inference per narrative
    until it was measured.

    Latency tracks the tokens actually EMITTED, not the ceiling — so a ceiling
    set at the latency budget does not make anything faster, it just truncates
    a well-formed reply into invalid JSON and spends the retry. At 160 the
    first attempt was truncated 5 times out of 5 and every narrative cost two
    inferences. The ceiling's job is to be above a good reply; the timeout's
    job is the latency.
  */
  it("keeps the output ceiling above that, so a good reply is never truncated", () => {
    expect(NARRATIVE_MAX_OUTPUT_TOKENS).toBeGreaterThan(worstCaseTokens);
  });

  /*
    And the same claim behaviourally, against a model that decodes at the
    measured rate. The clock is scaled so the suite does not sit for seven
    seconds; the RATIO of reply length to timeout is what is under test, and
    that is preserved exactly.
  */
  it("narrates rather than timing out, at the measured decode rate", async () => {
    const SPEEDUP = 50;
    const decodeMs = Math.round(
      (worstCaseTokens * MS_PER_OUTPUT_TOKEN) / SPEEDUP,
    );

    const slow: AiBinding = {
      run: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ response: GOOD }), decodeMs),
        ),
      aiGatewayLogId: "aig-1",
    };

    const out = await run(slow, { timeoutMs: NARRATIVE_TIMEOUT_MS / SPEEDUP });

    expect(out.narrative.status).toBe("narrated");
    // One inference, not two. A retry here would mean the first attempt was
    // truncated, which is the failure the ceiling above exists to prevent.
    expect(out.attempts).toHaveLength(1);
  });
});

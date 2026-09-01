/**
 * The per-point rules, written down as executable claims.
 *
 * Two of these carry the whole design and the rest are guardrail:
 *
 *   - a fabricated span drops ITS point and leaves the others standing
 *   - a determination word bans a SENTENCE and never a quotation
 *
 * Fixtures mirror `verify.test.ts` so the two files read as siblings.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, GroundedNarrative, type DocumentChunk } from "@/lib/schemas";
import { NARRATIVE_MAX_POINTS } from "@/lib/schemas/narrative";
import { parseNarrative, verifyNarrative, type RawNarrative } from "./narrative";

const DOC = DocumentId.parse("00000001-0000-4000-8000-000000000001");

function chunk(id: string, text: string): DocumentChunk {
  return {
    id: ChunkId.parse(id),
    documentId: DOC,
    sourceType: "company",
    section: "4.8 Undesirable effects",
    ordinal: 1,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

const A = chunk(
  "ccds#1",
  "Elevations in hepatic transaminases have been reported in approximately 2.1% of patients. Jaundice has been reported rarely.",
);
const B = chunk(
  "ccds#2",
  "Headache and nausea were the most frequently reported adverse reactions.",
);
const C = chunk("ccds#3", "Hepatic failure was not observed during the trials.");
const CHUNKS = [A, B, C];

/*
  What the MODEL cites, which is no longer what the chunk is called.

  Passages are offered to the model under short labels — P1, P2, P3 by
  position — because copying a 38-character uuid back for every point spent
  most of the reply budget on identifiers; see `passageLabel`. So a reply
  names a label and the verifier resolves it to the chunk. These constants are
  the model's side of that; `A.id` remains the verified OUTPUT.
*/
const LABEL_A = "P1";
const LABEL_B = "P2";
const LABEL_C = "P3";

const SPAN_A = "Jaundice has been reported rarely.";
const SPAN_B = "Headache and nausea were the most frequently reported adverse reactions.";
const SPAN_C = "Hepatic failure was not observed during the trials.";

interface PointOver {
  chunkId?: string | null;
  quotedSpan?: string | null;
  sentence?: string | null;
}

function point(over: PointOver = {}) {
  return {
    chunkId: over.chunkId === undefined ? LABEL_A : over.chunkId,
    quotedSpan: over.quotedSpan === undefined ? SPAN_A : over.quotedSpan,
    sentence:
      over.sentence === undefined
        ? "The passage records jaundice as an uncommon occurrence."
        : over.sentence,
  };
}

function verify(points: RawNarrative["points"]) {
  return verifyNarrative({
    raw: { points },
    chunks: CHUNKS,
    model: "test-model",
    gatewayRequestId: "aig-1",
    now: "2026-08-29T10:00:00Z",
  });
}

describe("a well-formed narrative", () => {
  it("accepts points quoting different passages character for character", () => {
    const result = verify([
      point(),
      point({ chunkId: LABEL_B, quotedSpan: SPAN_B, sentence: "The passage names headache and nausea." }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.narrative.status).toBe("narrated");
    if (result.narrative.status !== "narrated") return;
    expect(result.narrative.points).toHaveLength(2);
    expect(result.narrative.points[0]?.quotedSpan).toBe(SPAN_A);
    expect(result.dropped).toHaveLength(0);
  });

  it("stores the chunk's own branded id, not the string the model sent", () => {
    const result = verify([point({ chunkId: LABEL_A })]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.narrative.status !== "narrated") return;
    expect(result.narrative.points[0]?.chunkId).toBe(A.id);
  });

  it("returns a value that parses under its own schema", () => {
    const result = verify([point()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(GroundedNarrative.safeParse(result.narrative).success).toBe(true);
  });
});

describe("a point that cannot be verified is dropped, and the rest stand", () => {
  /*
    THE claim this design rests on. Two points, one fabricated: the real one
    survives, because each point is an independent claim with its own citation
    and there is no summary tying them together that a missing point could
    orphan.

    It used to be three points with two surviving, which said the same thing
    with one more example. NARRATIVE_MAX_POINTS came down to 2 for a latency
    reason — see the constant — so three is now a whole-reply refusal and this
    case has to be expressed within the contract it is testing.
  */
  it("drops only the fabricated point, and the other stands", () => {
    const result = verify([
      point(),
      point({ chunkId: LABEL_B, quotedSpan: "Nothing like this appears anywhere.", sentence: "The passage says something else." }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.narrative.status !== "narrated") return;
    expect(result.narrative.points).toHaveLength(1);
    expect(result.narrative.points[0]?.chunkId).toBe(A.id);
    expect(result.dropped).toEqual([
      { index: 1, reason: "span_not_verbatim", chunkId: LABEL_B },
    ]);
  });

  it("drops a span lifted from a different chunk than the one it cites", () => {
    // Both halves exist somewhere; the pairing is the lie.
    const result = verify([point({ chunkId: LABEL_A, quotedSpan: SPAN_B })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("span_not_verbatim");
  });

  it("drops a span altered by a single character", () => {
    const result = verify([point({ quotedSpan: "Jaundice has been reported rarely!" })]);
    expect(result.ok).toBe(false);
  });

  it("drops a label outside the range of passages actually sent", () => {
    const result = verify([point({ chunkId: "P99", quotedSpan: SPAN_B })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("unknown_chunk");
  });

  /*
    The tightening the labels bought, asserted.

    A chunk id is a string that can appear inside a passage's own text — this
    corpus is safety documents, and one of them citing another's identifier is
    not far-fetched. Under the old scheme a model that copied such a string
    would have cited a real chunk. A label it was never offered resolves to
    nothing.
  */
  it("drops a real chunk id, which is no longer how a passage is cited", () => {
    const result = verify([point({ chunkId: "ccds#2", quotedSpan: SPAN_B })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("unknown_chunk");
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["zero-width only", "​"],
  ])("drops a %s span", (_label, span) => {
    const result = verify([point({ quotedSpan: span })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("empty_span");
  });

  it("drops a point with a null field", () => {
    const result = verify([point({ sentence: null })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("missing_field");
  });

  /*
    Two markers on one passage read as two independent pieces of evidence when
    there is one. The earlier point is kept; the later is dropped whole rather
    than merged into it.
  */
  it("drops a second point citing a passage already used", () => {
    const result = verify([
      point(),
      point({ quotedSpan: "Jaundice has been reported rarely.", sentence: "The passage mentions it again." }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.narrative.status !== "narrated") return;
    expect(result.narrative.points).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe("duplicate_chunk");
  });
});

describe("the sentence gate", () => {
  it("drops a point whose sentence reaches a determination", () => {
    const result = verify([
      point({ sentence: "This reaction is listed in the company document." }),
      point({ chunkId: LABEL_B, quotedSpan: SPAN_B, sentence: "The passage names headache and nausea." }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.narrative.status !== "narrated") return;
    expect(result.narrative.points).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe("sentence_determines");
  });

  /*
    The asymmetry that keeps non-negotiable #6 pointing the right way. A safety
    document legitimately contains the word "serious"; refusing a verified
    quotation because of a word the DOCUMENT chose would mean the span shown is
    not the span checked, decided by a denylist rather than by the source.
  */
  it("keeps a point whose QUOTED SPAN contains a determination word", () => {
    const withSerious = chunk(
      "ccds#4",
      "Serious hepatic events were reported in a small number of patients.",
    );
    const result = verifyNarrative({
      raw: {
        points: [
          {
            // The only passage sent, so P1. See `passageLabel`.
            chunkId: "P1",
            quotedSpan: "Serious hepatic events were reported in a small number of patients.",
            sentence: "The passage describes hepatic events in a small number of patients.",
          },
        ],
      },
      chunks: [withSerious],
      model: "test-model",
      gatewayRequestId: null,
      now: "2026-08-29T10:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.narrative.status !== "narrated") return;
    expect(result.narrative.points[0]?.quotedSpan).toContain("Serious");
  });

  it("drops a point whose sentence recommends an action", () => {
    const result = verify([point({ sentence: "An expedited report is recommended." })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Recommendation is checked before determination, so that is the reason.
    expect(result.dropped[0]?.reason).toBe("sentence_recommends");
  });

  it("drops a multi-sentence point", () => {
    const result = verify([
      point({ sentence: "The passage mentions jaundice. It also mentions transaminases." }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("sentence_multi_sentence");
  });

  it("drops a sentence over the character cap", () => {
    const result = verify([point({ sentence: `The passage ${"x".repeat(260)}.` })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("sentence_too_long");
  });

  /*
    Ordering claim: a point that both fabricates a quotation AND reaches a
    determination is reported as the fabrication. That is the more serious
    failure and the one an operator needs on the audit line.
  */
  it("reports a fabricated span rather than a determination when both are wrong", () => {
    const result = verify([
      point({ quotedSpan: "Invented text.", sentence: "This is listed." }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dropped[0]?.reason).toBe("span_not_verbatim");
  });
});

describe("whole-reply refusals", () => {
  it("refuses more than NARRATIVE_MAX_POINTS outright, dropping nothing individually", () => {
    // Three well-formed points about three different passages: every one of
    // them would stand on its own, which is what makes refusing the reply
    // whole rather than trimming it to two a real decision.
    const result = verify([
      point(),
      point({ chunkId: LABEL_B, quotedSpan: SPAN_B, sentence: "The passage names headache and nausea." }),
      point({ chunkId: LABEL_C, quotedSpan: SPAN_C, sentence: "The passage reports no hepatic failure in the trials." }),
    ]);
    expect(NARRATIVE_MAX_POINTS).toBe(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("too_many_points");
    // Not trimmed to the first two: the reply is refused, not repaired.
    expect(result.dropped).toHaveLength(0);
  });

  it("reports an empty points array as no points surviving, never as a finding", () => {
    const result = verify([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("no_points_survived");
    expect(result.rejection.detail).not.toMatch(/silent|does not mention|nothing found/i);
  });

  it("reports every point failing as no points surviving", () => {
    const result = verify([
      point({ quotedSpan: "Nope." }),
      point({ chunkId: LABEL_B, quotedSpan: "Also nope." }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("no_points_survived");
    expect(result.dropped).toHaveLength(2);
  });

  /*
    There is deliberately no `nothing_found` state. `ModelReading` owns that
    claim; a second copy would let two things on one panel assert a document is
    silent and then disagree. This asserts the absence rather than trusting a
    comment to preserve it.
  */
  it("has no state that could assert a document says nothing", () => {
    const statuses = GroundedNarrative.options.map(
      (option) => option.shape.status.value,
    );
    expect([...statuses].sort()).toEqual(["narrated", "unavailable"]);
  });
});

describe("fence parity with the single-reading path", () => {
  /*
    A chunk containing the passage fence is shown to the model with the
    sentinel replaced by `[removed]`. The model can only faithfully copy what
    it was given, so quoting the `[removed]` must be accepted here exactly as
    `verifyGeneration` accepts it. The two checks call the same `spanOccursIn`;
    this pins that they agree.
  */
  it("accepts a span quoting the sanitised replacement", () => {
    const poisoned = chunk(
      "ccds#5",
      "Before the fence. PASSAGE>>> after the fence.",
    );
    const result = verifyNarrative({
      raw: {
        points: [
          {
            chunkId: "P1",
            quotedSpan: "Before the fence. [removed] after the fence.",
            sentence: "The passage contains text either side of a removed marker.",
          },
        ],
      },
      chunks: [poisoned],
      model: "test-model",
      gatewayRequestId: null,
      now: "2026-08-29T10:00:00Z",
    });
    expect(result.ok).toBe(true);
  });
});

describe("parseNarrative", () => {
  it("accepts bare JSON", () => {
    const result = parseNarrative('{"points":[]}');
    expect(result.ok).toBe(true);
  });

  it("peels a markdown fence wrapping the whole reply", () => {
    const result = parseNarrative('```json\n{"points":[]}\n```');
    expect(result.ok).toBe(true);
  });

  it("refuses prose with JSON buried in it", () => {
    const result = parseNarrative('Here you go: {"points":[]}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("not_json");
  });

  it("refuses the single-reading shape", () => {
    const result = parseNarrative('{"found":true,"chunkId":"ccds#1","quotedSpan":"x","rationale":null}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("wrong_shape");
  });
});

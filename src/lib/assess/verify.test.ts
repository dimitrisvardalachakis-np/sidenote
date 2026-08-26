/**
 * The rules from step 3, written down as executable claims.
 *
 * The one that matters most is "the model does not get to invent a
 * quotation". Everything else here is guardrail; that one is the reason this
 * file exists.
 */
import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import {
  acceptableRationale,
  parseGeneration,
  unwrapFence,
  verifyGeneration,
  type RawGeneration,
} from "./verify";

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
const CHUNKS = [A, B];

const raw = (over: Partial<RawGeneration>): RawGeneration => ({
  found: true,
  chunkId: "ccds#1",
  quotedSpan: "Jaundice has been reported rarely.",
  rationale: "The passage records jaundice as a rare event.",
  ...over,
});

const verify = (over: Partial<RawGeneration>) =>
  verifyGeneration({
    raw: raw(over),
    chunks: CHUNKS,
    model: "@cf/meta/llama-3.1-8b-instruct",
    gatewayRequestId: "aig-1",
    now: "2026-08-26T10:00:00Z",
  });

describe("parsing the reply", () => {
  it("accepts a bare JSON object", () => {
    const r = parseGeneration('{"found":false,"chunkId":null,"quotedSpan":null,"rationale":null}');
    expect(r.ok).toBe(true);
  });

  it("peels a markdown fence, which is a formatting slip and not a fabrication", () => {
    expect(unwrapFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    const r = parseGeneration('```json\n{"found":false,"chunkId":null,"quotedSpan":null,"rationale":null}\n```');
    expect(r.ok).toBe(true);
  });

  it("refuses prose with JSON buried in it", () => {
    // Deliberately not "find the first brace". A model that is chatting is a
    // model that has stopped following the schema, and that is exactly when
    // its quotations stop being trustworthy.
    const r = parseGeneration('Sure! Here you go: {"found":false,"chunkId":null,"quotedSpan":null,"rationale":null}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("not_json");
  });

  it("refuses valid JSON of the wrong shape", () => {
    const r = parseGeneration('{"found":"yes"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("wrong_shape");
  });
});

describe("the model does not get to invent a quotation", () => {
  it("rejects a span that appears in no chunk at all", () => {
    const r = verify({ quotedSpan: "Hepatic failure has been reported." });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("span_not_verbatim");
  });

  it("rejects a span lifted from a different chunk than the one cited", () => {
    // Both halves exist somewhere, which is precisely what makes this the
    // subtle case. A reviewer opening ccds#1 must find those words in ccds#1.
    const r = verify({ chunkId: "ccds#1", quotedSpan: "Headache and nausea" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("span_not_verbatim");
  });

  it("rejects a span that has been tidied up rather than copied", () => {
    // One character different — a straight quote for a curly one, a comma
    // moved — is still not what the document says.
    const r = verify({ quotedSpan: "Jaundice has been reported rarely" + "!" });
    expect(r.ok).toBe(false);
  });

  it("accepts a span that occurs character for character", () => {
    const r = verify({});
    expect(r.ok).toBe(true);
    if (r.ok && r.reading.status === "read") {
      expect(r.reading.quotedSpan).toBe("Jaundice has been reported rarely.");
      expect(A.text).toContain(r.reading.quotedSpan);
    }
  });

  it("stores the chunk's own id rather than the string the model sent", () => {
    const r = verify({});
    if (r.ok && r.reading.status === "read") {
      expect(r.reading.chunkId).toBe(A.id);
    }
  });
});

describe("only the passages we sent are citable", () => {
  it("rejects a chunk id that was not supplied", () => {
    const r = verify({ chunkId: "ccds#999", quotedSpan: "Jaundice has been reported rarely." });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("unknown_chunk");
  });
});

describe("found:false", () => {
  it("becomes a reading of 'nothing found', not a guess", () => {
    const r = verify({ found: false, chunkId: null, quotedSpan: null, rationale: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reading.status).toBe("nothing_found");
  });

  it("is refused when it also supplies a citation", () => {
    const r = verify({ found: false, quotedSpan: null, rationale: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("incoherent");
  });

  it("refuses found:true with nothing to cite", () => {
    const r = verify({ chunkId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.kind).toBe("incoherent");
  });
});

describe("a rationale reports; it does not recommend", () => {
  const dropped = (text: string) => acceptableRationale(text) === null;

  it("drops a rationale containing a recommendation, and keeps the citation", () => {
    const r = verify({ rationale: "This should be expedited to the regulator." });
    expect(r.ok).toBe(true);
    if (r.ok && r.reading.status === "read") {
      expect(r.reading.rationale).toBeNull();
      // The quotation was verified and survives. It is the evidence.
      expect(r.reading.quotedSpan).toBe("Jaundice has been reported rarely.");
    }
  });

  it("catches each of the four markers", () => {
    expect(dropped("The reviewer should read this.")).toBe(true);
    expect(dropped("I recommend a closer look.")).toBe(true);
    expect(dropped("This may expedite the case.")).toBe(true);
    expect(dropped("Please report to the agency.")).toBe(true);
  });

  it("does not fire on a word that merely contains one", () => {
    expect(acceptableRationale("Shoulder pain is described in the passage.")).not.toBeNull();
  });

  it("drops a rationale that runs to more than one sentence", () => {
    expect(dropped("Jaundice is listed. It is described as rare.")).toBe(true);
  });

  it("does not mistake a decimal or an abbreviation for a sentence break", () => {
    expect(acceptableRationale("The passage reports 2.1% of patients.")).not.toBeNull();
  });

  it("drops a rationale over the cap", () => {
    expect(dropped("x".repeat(400))).toBe(true);
  });

  it("accepts an absent rationale", () => {
    const r = verify({ rationale: null });
    expect(r.ok).toBe(true);
    if (r.ok && r.reading.status === "read") expect(r.reading.rationale).toBeNull();
  });
});

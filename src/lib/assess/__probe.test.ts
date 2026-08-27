import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import { verifyGeneration } from "./verify";
import { scoreReading } from "@/lib/evals/faithfulness";

const TEXT = "Hepatic <<<PASSAGE failure was seen.";
const CH: DocumentChunk = {
  id: ChunkId.parse("company#12"),
  documentId: DocumentId.parse("0000000f-0000-4000-8000-0000000000ff"),
  sourceType: "company",
  section: "4.8",
  ordinal: 0,
  text: TEXT,
  charStart: 0,
  charEnd: TEXT.length,
  tokenEstimate: 9,
};

describe("probe", () => {
  it("diverges", () => {
    const span = "Hepatic [removed] failure was seen.";
    const v = verifyGeneration({
      raw: { found: true, chunkId: "company#12", quotedSpan: span, rationale: null },
      chunks: [CH],
      model: "@cf/meta/llama-3.1-8b-instruct",
      gatewayRequestId: null,
      now: "2026-08-26T10:00:00Z",
    });
    console.log("VERIFY:", JSON.stringify(v));
    if (v.ok && v.reading.status === "read") {
      console.log("EVAL:", JSON.stringify(scoreReading({ reading: v.reading, chunks: [CH] })));
    }
  });
});

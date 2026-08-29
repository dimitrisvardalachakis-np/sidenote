import { describe, expect, it } from "vitest";
import { DocumentId, ChunkId, type DocumentChunk, type SafetyDocument } from "@/lib/schemas";
import { passageContext, spanOffsets } from "./context";

const DOC_A = DocumentId.parse("00000001-0000-4000-8000-00000000000a");
const DOC_B = DocumentId.parse("00000001-0000-4000-8000-00000000000b");

function chunk(doc: DocumentId, ordinal: number, text: string): DocumentChunk {
  return {
    id: ChunkId.parse(`${doc}#${ordinal}`),
    documentId: doc,
    sourceType: "company",
    section: `Section ${ordinal}`,
    ordinal,
    text,
    charStart: ordinal * 100,
    charEnd: ordinal * 100 + text.length,
    tokenEstimate: 20,
  };
}

// Deliberately out of order, because the corpus is a merge and nothing
// promises sorted input.
const CHUNKS = [
  chunk(DOC_A, 2, "Third passage."),
  chunk(DOC_B, 0, "Another document entirely."),
  chunk(DOC_A, 0, "First passage."),
  chunk(DOC_A, 1, "Second passage, the one cited."),
  chunk(DOC_A, 3, "Fourth passage."),
];

const DOCUMENTS = [
  { id: DOC_A, title: "Hepalex CCDS" } as unknown as SafetyDocument,
];

describe("passageContext", () => {
  it("finds the chunk and its immediate neighbours", () => {
    const out = passageContext(CHUNKS, DOCUMENTS, `${DOC_A}#1`);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.chunk.text).toBe("Second passage, the one cited.");
    expect(out.before.map((c) => c.ordinal)).toEqual([0]);
    expect(out.after.map((c) => c.ordinal)).toEqual([2]);
  });

  it("orders neighbours by ordinal, not by array position", () => {
    const out = passageContext(CHUNKS, DOCUMENTS, `${DOC_A}#2`, 2);
    if (out === null) throw new Error("expected a context");
    expect(out.before.map((c) => c.ordinal)).toEqual([0, 1]);
    expect(out.after.map((c) => c.ordinal)).toEqual([3]);
  });

  it("never crosses into another document", () => {
    const out = passageContext(CHUNKS, DOCUMENTS, `${DOC_A}#0`, 3);
    if (out === null) throw new Error("expected a context");
    const ids = [...out.before, ...out.after].map((c) => c.documentId);
    expect(ids.every((id) => id === DOC_A)).toBe(true);
    expect(out.total).toBe(4);
  });

  it("reports a 1-based position for a human-readable counter", () => {
    const out = passageContext(CHUNKS, DOCUMENTS, `${DOC_A}#0`);
    if (out === null) throw new Error("expected a context");
    expect(out.position).toBe(1);
    expect(out.before).toHaveLength(0);
  });

  it("clamps at the end of a document", () => {
    const out = passageContext(CHUNKS, DOCUMENTS, `${DOC_A}#3`);
    if (out === null) throw new Error("expected a context");
    expect(out.after).toHaveLength(0);
    expect(out.position).toBe(4);
  });

  it("returns null for a chunk id nobody holds", () => {
    expect(passageContext(CHUNKS, DOCUMENTS, `${DOC_A}#99`)).toBeNull();
  });

  it("returns a null document rather than failing when the parent is gone", () => {
    const out = passageContext(CHUNKS, [], `${DOC_A}#1`);
    expect(out?.document).toBeNull();
  });
});

describe("spanOffsets", () => {
  it("locates a span inside its passage", () => {
    expect(spanOffsets("Jaundice has been reported rarely.", "has been")).toEqual({
      start: 9,
      end: 17,
    });
  });

  /*
    The same discipline as the narrative highlighting: a span that does not
    occur is dropped, never approximated. The caller renders the passage
    unmarked rather than guessing where the quotation was meant to go.
  */
  it("returns null for a span that does not occur, rather than a best guess", () => {
    expect(spanOffsets("Jaundice has been reported.", "Fatal hepatic failure")).toBeNull();
  });

  it("is exact — no whitespace or punctuation normalisation", () => {
    expect(spanOffsets("Jaundice  has been reported.", "Jaundice has been")).toBeNull();
    expect(spanOffsets("It was “rare”.", 'It was "rare"')).toBeNull();
  });

  it("returns null for an empty span rather than matching at zero", () => {
    expect(spanOffsets("anything", "")).toBeNull();
  });
});

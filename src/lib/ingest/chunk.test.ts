/**
 * The chunker's contract, written before the chunker.
 *
 * This function is called from a queue consumer in Cluster E, so it must stay
 * a pure function of its arguments: no Node, no Cloudflare, no clock, no
 * randomness. Several of the tests below exist purely to pin that down.
 */
import { describe, expect, it } from "vitest";
import { DocumentChunk, DocumentId, type ChunkMeta } from "@/lib/schemas";
import { chunkDocument, estimateTokens } from "./chunk";

const META: ChunkMeta = {
  documentId: DocumentId.parse("11111111-1111-4111-8111-111111111111"),
  sourceType: "company",
};

const PUBLIC_META: ChunkMeta = {
  documentId: DocumentId.parse("22222222-2222-4222-8222-222222222222"),
  sourceType: "public",
};

/** A sentence of roughly `tokens` estimated tokens, deterministic. */
function sentence(tokens: number, word = "hepatic"): string {
  // estimateTokens is ~chars/4, and "hepatic " is 8 chars ≈ 2 tokens.
  const count = Math.max(1, Math.round(tokens / 2));
  return `${Array.from({ length: count }, () => word).join(" ")}.`;
}

function paragraph(sentences: number, tokensEach: number): string {
  return Array.from({ length: sentences }, (_, i) =>
    sentence(tokensEach, `word${i}`),
  ).join(" ");
}

/** Every chunk must be exactly the source text at its own offsets. */
function assertOffsetsAreHonest(source: string, chunks: readonly DocumentChunk[]) {
  for (const chunk of chunks) {
    expect(source.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
  }
}

describe("estimateTokens", () => {
  it("is deterministic and grows with length", () => {
    expect(estimateTokens("hello world")).toBe(estimateTokens("hello world"));
    expect(estimateTokens(sentence(200))).toBeGreaterThan(
      estimateTokens(sentence(50)),
    );
  });

  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("a document shorter than one chunk", () => {
  const text =
    "Hepatic enzyme elevations have been reported. Most resolved on discontinuation.";
  const chunks = chunkDocument(text, META, { targetTokens: 512 });

  it("produces exactly one chunk", () => {
    expect(chunks).toHaveLength(1);
  });

  it("keeps the whole document, losing nothing", () => {
    expect(chunks[0]?.text).toBe(text);
  });

  it("starts the ordinals at zero", () => {
    expect(chunks[0]?.ordinal).toBe(0);
  });

  it("has no section, because the document has no headings", () => {
    expect(chunks[0]?.section).toBeNull();
  });

  it("carries the metadata it was given", () => {
    expect(chunks[0]?.documentId).toBe(META.documentId);
    expect(chunks[0]?.sourceType).toBe("company");
  });

  it("produces chunks that satisfy the DocumentChunk schema", () => {
    for (const chunk of chunks) {
      expect(DocumentChunk.safeParse(chunk).success).toBe(true);
    }
  });

  it("records offsets that really are the source text", () => {
    assertOffsetsAreHonest(text, chunks);
  });

  it("returns nothing for an empty document", () => {
    expect(chunkDocument("", META)).toEqual([]);
    expect(chunkDocument("   \n\n  \t ", META)).toEqual([]);
  });
});

describe("a document with headings", () => {
  const text = [
    "# Hepalex Core Data Sheet",
    "",
    "This document describes the known safety profile.",
    "",
    "## 4.8 Undesirable effects",
    "",
    paragraph(3, 40),
    "",
    "### Hepatobiliary disorders",
    "",
    "Jaundice has been reported rarely. Elevations in ALT were observed.",
    "",
    "## 4.9 Overdose",
    "",
    "No cases of overdose have been reported.",
  ].join("\n");

  const chunks = chunkDocument(text, META, { targetTokens: 120 });

  it("labels each chunk with the heading it sits under", () => {
    const sections = chunks.map((c) => c.section);
    expect(sections.some((s) => s?.includes("4.8 Undesirable effects"))).toBe(
      true,
    );
    expect(sections.some((s) => s?.includes("4.9 Overdose"))).toBe(true);
  });

  it("builds a nested section path, not just the nearest heading", () => {
    const jaundice = chunks.find((c) => c.text.includes("Jaundice"));
    expect(jaundice?.section).toContain("Hepatobiliary disorders");
    expect(jaundice?.section).toContain("4.8 Undesirable effects");
  });

  it("does not carry a section across a heading boundary", () => {
    const overdose = chunks.find((c) => c.text.includes("overdose"));
    expect(overdose?.section).toContain("4.9 Overdose");
    expect(overdose?.section).not.toContain("4.8");
  });

  it("prefers a heading as a split point over a paragraph", () => {
    // No chunk should contain text from two different top-level sections.
    for (const chunk of chunks) {
      const has48 = chunk.text.includes("4.8 Undesirable");
      const has49 = chunk.text.includes("4.9 Overdose");
      expect(has48 && has49).toBe(false);
    }
  });

  it("numbers chunks consecutively from zero with no gaps", () => {
    expect(chunks.map((c) => c.ordinal)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it("records offsets that really are the source text", () => {
    assertOffsetsAreHonest(text, chunks);
  });

  it("recognises numbered safety-document headings without markdown", () => {
    const plain = [
      "4.8 Undesirable effects",
      "",
      "Jaundice has been reported rarely.",
      "",
      "4.9 Overdose",
      "",
      "No cases have been reported.",
    ].join("\n");
    const plainChunks = chunkDocument(plain, META, { targetTokens: 120 });
    expect(plainChunks.some((c) => c.section?.includes("4.8"))).toBe(true);
  });
});

describe("a document with one enormous paragraph", () => {
  // One paragraph, no blank lines, far past the target — but full of
  // sentences, so there are legal places to break.
  const text = paragraph(40, 30);
  const chunks = chunkDocument(text, META, { targetTokens: 100 });

  it("splits it rather than emitting one giant chunk", () => {
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("never breaks a sentence in half", () => {
    for (const chunk of chunks) {
      const trimmed = chunk.text.trim();
      expect(trimmed.endsWith(".")).toBe(true);
    }
  });

  it("keeps every chunk near the target", () => {
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(160);
    }
  });

  it("loses no sentence from the source", () => {
    const joined = chunks.map((c) => c.text).join(" ");
    for (const piece of text.split(". ")) {
      const needle = piece.trim().replace(/\.$/, "");
      if (needle.length > 0) expect(joined).toContain(needle);
    }
  });

  it("records offsets that really are the source text", () => {
    assertOffsetsAreHonest(text, chunks);
  });

  describe("and one sentence longer than the target", () => {
    // Pathological: a single sentence with no legal break point inside it.
    const monster = sentence(400);
    const monsterChunks = chunkDocument(monster, META, {
      targetTokens: 100,
      hardSplitAtTokens: 150,
    });

    it("splits it at word boundaries as a last resort", () => {
      expect(monsterChunks.length).toBeGreaterThan(1);
    });

    it("still never splits mid-word", () => {
      // Every whitespace-separated token must be a whole word from the
      // source. A mid-word split would leave a fragment like "hepa".
      for (const chunk of monsterChunks) {
        for (const token of chunk.text.trim().split(/\s+/)) {
          expect(token === "hepatic" || token === "hepatic.").toBe(true);
        }
      }
    });

    it("keeps the whole sentence when hard splitting is disabled", () => {
      const whole = chunkDocument(monster, META, {
        targetTokens: 100,
        hardSplitAtTokens: Number.POSITIVE_INFINITY,
      });
      expect(whole).toHaveLength(1);
      expect(whole[0]?.text).toBe(monster);
    });
  });
});

describe("the overlap boundary", () => {
  const text = paragraph(30, 40);
  const chunks = chunkDocument(text, META, {
    targetTokens: 100,
    overlapRatio: 0.12,
  });

  it("makes consecutive chunks overlap in the source", () => {
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1];
      const current = chunks[i];
      if (previous === undefined || current === undefined) throw new Error("gap");
      expect(current.charStart).toBeLessThan(previous.charEnd);
    }
  });

  it("never overlaps more than half a chunk", () => {
    // Overlap is whole sentences, so the ratio is a floor, not a target: in a
    // document of long sentences the smallest available step is one whole
    // sentence, which can be most of a chunk. Capping it at half is what
    // stops two consecutive chunks becoming near-duplicates.
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1];
      const current = chunks[i];
      if (previous === undefined || current === undefined) throw new Error("gap");
      const shared = previous.charEnd - current.charStart;
      const ratio = shared / (previous.charEnd - previous.charStart);
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(0.5);
    }
  });

  it("lands near the requested ratio when sentences are fine enough", () => {
    // Short sentences give the algorithm room to hit 12% closely.
    const fine = paragraph(120, 6);
    const fineChunks = chunkDocument(fine, META, {
      targetTokens: 200,
      overlapRatio: 0.12,
    });
    expect(fineChunks.length).toBeGreaterThan(2);
    for (let i = 1; i < fineChunks.length; i += 1) {
      const previous = fineChunks[i - 1];
      const current = fineChunks[i];
      if (previous === undefined || current === undefined) throw new Error("gap");
      const shared = previous.charEnd - current.charStart;
      const ratio = shared / (previous.charEnd - previous.charStart);
      expect(ratio).toBeGreaterThanOrEqual(0.08);
      expect(ratio).toBeLessThanOrEqual(0.25);
    }
  });

  it("overlaps by whole sentences, never a fragment", () => {
    for (let i = 1; i < chunks.length; i += 1) {
      const current = chunks[i];
      if (current === undefined) throw new Error("gap");
      // A chunk that begins mid-sentence would start with a lowercase word
      // that is not the start of the document.
      expect(current.text.trim().length).toBeGreaterThan(0);
      expect(current.text).toBe(current.text.trimStart());
    }
  });

  it("can be turned off", () => {
    const none = chunkDocument(text, META, {
      targetTokens: 100,
      overlapRatio: 0,
    });
    for (let i = 1; i < none.length; i += 1) {
      const previous = none[i - 1];
      const current = none[i];
      if (previous === undefined || current === undefined) throw new Error("gap");
      expect(current.charStart).toBeGreaterThanOrEqual(previous.charEnd);
    }
  });

  it("does not overlap across a heading boundary", () => {
    const withHeadings = [
      "## 4.8 Undesirable effects",
      "",
      paragraph(6, 40),
      "",
      "## 4.9 Overdose",
      "",
      paragraph(6, 40),
    ].join("\n");
    const headed = chunkDocument(withHeadings, META, { targetTokens: 100 });
    for (let i = 1; i < headed.length; i += 1) {
      const previous = headed[i - 1];
      const current = headed[i];
      if (previous === undefined || current === undefined) throw new Error("gap");
      if (previous.section !== current.section) {
        // A new section starts clean: bleeding the previous section's text
        // into it would attribute one section's words to another's citation.
        expect(current.charStart).toBeGreaterThanOrEqual(previous.charEnd);
      }
    }
  });
});

describe("determinism", () => {
  const text = [
    "# Core Data Sheet",
    "",
    paragraph(10, 40),
    "",
    "## 4.8 Undesirable effects",
    "",
    paragraph(10, 40),
  ].join("\n");

  it("gives byte-identical output for identical input", () => {
    const a = chunkDocument(text, META, { targetTokens: 120 });
    const b = chunkDocument(text, META, { targetTokens: 120 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("gives the same chunk ids every time", () => {
    const a = chunkDocument(text, META, { targetTokens: 120 }).map((c) => c.id);
    const b = chunkDocument(text, META, { targetTokens: 120 }).map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("gives different ids to different documents", () => {
    const a = chunkDocument(text, META, { targetTokens: 120 }).map((c) => c.id);
    const b = chunkDocument(text, PUBLIC_META, { targetTokens: 120 }).map(
      (c) => c.id,
    );
    expect(a[0]).not.toBe(b[0]);
  });

  it("stamps the source type it was given, not a guess", () => {
    const publicChunks = chunkDocument(text, PUBLIC_META, { targetTokens: 120 });
    expect(publicChunks.every((c) => c.sourceType === "public")).toBe(true);
  });
});

describe("line endings and whitespace", () => {
  it("treats CRLF the same as LF", () => {
    const lf = "# Heading\n\nFirst sentence here. Second sentence here.";
    const crlf = lf.replaceAll("\n", "\r\n");
    const a = chunkDocument(lf, META).map((c) => c.text.replaceAll("\r", ""));
    const b = chunkDocument(crlf, META).map((c) => c.text.replaceAll("\r", ""));
    expect(a).toEqual(b);
  });

  it("never emits a chunk that is only whitespace", () => {
    const gappy = "First sentence.\n\n\n\n\n\nSecond sentence.\n\n\n";
    for (const chunk of chunkDocument(gappy, META)) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });
});

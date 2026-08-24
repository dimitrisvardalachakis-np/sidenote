import { describe, expect, it } from "vitest";
import {
  assessExtraction,
  isAcceptedFilename,
  MIN_CHARS_PER_PAGE,
} from "./extract";

const page = (chars: number) => "a".repeat(chars);

describe("assessExtraction", () => {
  it("accepts a normal text document", () => {
    const result = assessExtraction({ pageCount: 3, text: page(4500) });
    expect(result.ok).toBe(true);
  });

  it("rejects a scanned PDF with the exact wording CLAUDE.md requires", () => {
    const result = assessExtraction({ pageCount: 12, text: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_text_layer");
    expect(result.message).toBe(
      "This PDF has no text layer — it needs OCR before it can be used.",
    );
  });

  it("rejects a scan that leaked a few stray characters", () => {
    // A scanner stamp or a page number encoded as text: not a text layer.
    const result = assessExtraction({ pageCount: 40, text: "Page 1 of 40" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_text_layer");
  });

  it("rejects a document with no pages at all", () => {
    const result = assessExtraction({ pageCount: 0, text: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty_document");
  });

  it("accepts a short but genuine one-page document", () => {
    const result = assessExtraction({
      pageCount: 1,
      text: "Jaundice has been reported rarely in post-marketing experience.",
    });
    expect(result.ok).toBe(true);
  });

  it("uses characters per page, not total characters", () => {
    // Same text; the page count is what decides.
    const text = page(600);
    expect(assessExtraction({ pageCount: 2, text }).ok).toBe(true);
    expect(assessExtraction({ pageCount: 200, text }).ok).toBe(false);
  });

  it("sits at the documented threshold", () => {
    const justUnder = page(MIN_CHARS_PER_PAGE - 1);
    const justOver = page(MIN_CHARS_PER_PAGE + 1);
    expect(assessExtraction({ pageCount: 1, text: justUnder }).ok).toBe(false);
    expect(assessExtraction({ pageCount: 1, text: justOver }).ok).toBe(true);
  });

  it("ignores whitespace when measuring", () => {
    const whitespaceOnly = " \n\t".repeat(2000);
    const result = assessExtraction({ pageCount: 5, text: whitespaceOnly });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_text_layer");
  });
});

describe("isAcceptedFilename", () => {
  it("accepts the three formats the library reads", () => {
    expect(isAcceptedFilename("ccds-v7.2.pdf")).toBe(true);
    expect(isAcceptedFilename("label.MD")).toBe(true);
    expect(isAcceptedFilename("notes.txt")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isAcceptedFilename("scan.png")).toBe(false);
    expect(isAcceptedFilename("brochure.docx")).toBe(false);
    expect(isAcceptedFilename("pdf")).toBe(false);
  });
});

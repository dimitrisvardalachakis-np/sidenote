/**
 * Deciding whether an extraction actually produced a usable document.
 *
 * Pure and platform-free, like the chunker, so it can be tested without a
 * browser and reused server-side if a document ever arrives by another route.
 * The pdf.js call that produces the input lives in pdf-client.ts, which is
 * browser-only by necessity.
 *
 * CLAUDE.md: "Scanned PDFs with no text layer are rejected with 'needs OCR'
 * rather than silently ingesting nothing." That sentence is the reason this
 * file exists. A scanned PDF extracts to an empty string, and an empty string
 * chunks to zero chunks — which looks exactly like a document that simply
 * does not mention the reaction. A reviewer would read that as "not listed"
 * and start a 15-day clock on the strength of a file nobody could read.
 */
import { REJECTION_MESSAGES, type RejectionReason } from "@/lib/schemas";

export interface RawExtraction {
  readonly pageCount: number;
  /** Everything pdf.js could read, pages joined. */
  readonly text: string;
}

export type ExtractionAssessment =
  | { readonly ok: true; readonly text: string; readonly pageCount: number }
  | {
      readonly ok: false;
      readonly reason: RejectionReason;
      /** Exact words for the reviewer. Comes from the schema, not invented here. */
      readonly message: string;
    };

/**
 * Below this many characters per page, we call it a scan.
 *
 * A text page in a safety document runs 1,500–3,000 characters. A scanned
 * page yields zero, or a handful from a stamped header the scanner happened
 * to encode. Twenty-five is comfortably above the noise and far below any
 * real page — even a sparse title page clears it.
 */
export const MIN_CHARS_PER_PAGE = 25;

export function assessExtraction(
  extraction: RawExtraction,
  minCharsPerPage: number = MIN_CHARS_PER_PAGE,
): ExtractionAssessment {
  const text = extraction.text;
  const trimmedLength = text.trim().length;

  if (extraction.pageCount <= 0) {
    return {
      ok: false,
      reason: "empty_document",
      message: REJECTION_MESSAGES.empty_document,
    };
  }

  if (trimmedLength === 0) {
    return {
      ok: false,
      reason: "no_text_layer",
      message: REJECTION_MESSAGES.no_text_layer,
    };
  }

  if (trimmedLength / extraction.pageCount < minCharsPerPage) {
    return {
      ok: false,
      reason: "no_text_layer",
      message: REJECTION_MESSAGES.no_text_layer,
    };
  }

  return { ok: true, text, pageCount: extraction.pageCount };
}

/** File types the library accepts. Anything else is refused before reading. */
export const ACCEPTED_EXTENSIONS = [".pdf", ".md", ".txt"] as const;

export function isAcceptedFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}


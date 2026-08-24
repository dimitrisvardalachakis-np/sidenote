/**
 * Browser-side text extraction.
 *
 * CLAUDE.md calls this out specifically: "Text is extracted client-side
 * (pdf.js in the browser). pdf-parse and friends import fs and will not run on
 * Workers — this is deliberate, and it is one of the three 'won't run on the
 * edge' modules Cluster C asks for."
 *
 * So this module is the deliberate exception to the rest of src/lib, which is
 * platform-free. It runs in the browser only. pdfjs-dist is loaded with a
 * dynamic import so it never lands in a server bundle, and so the ~1MB of
 * parser is only fetched by a reviewer who actually drops a file in.
 *
 * The pure half of the decision — is this extraction usable, or is it a scan —
 * lives in extract.ts, where it can be tested without a browser.
 */
import { isAcceptedFilename } from "./extract";
import type { RawExtraction } from "./extract";

export class NotABrowserError extends Error {
  constructor() {
    super("extractTextFromFile can only run in a browser");
    this.name = "NotABrowserError";
  }
}

/** Loaded once, lazily. */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjsPromise === null) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // The worker keeps parsing off the main thread; a 400-page CCDS would
      // otherwise freeze the tab for several seconds. The URL form lets the
      // bundler fingerprint and serve the worker itself, rather than us
      // copying a versioned file into public/ and forgetting to update it.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function extractPdf(bytes: ArrayBuffer): Promise<RawExtraction> {
  const pdfjs = await loadPdfjs();
  // Keep the loading task: it owns the worker, and destroying it is what
  // releases that worker. Dropping only the document proxy leaks a thread per
  // upload, which a reviewer processing a batch of labels would notice.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await loadingTask.promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    let pageText = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pageText += item.str;
      // hasEOL is what preserves line structure, and line structure is what
      // the chunker's heading detection runs on. Join everything into one
      // stream and "4.8 Undesirable effects" stops being a line and becomes
      // the middle of a sentence.
      if (item.hasEOL) pageText += "\n";
    }
    pages.push(pageText);
    page.cleanup();
  }
  const pageCount = doc.numPages;
  await loadingTask.destroy();

  return {
    pageCount,
    // A page break is a paragraph break as far as the chunker is concerned.
    text: normaliseWhitespace(pages.join("\n\n")),
  };
}

/**
 * Tidy the extraction without destroying structure.
 *
 * pdf.js emits a newline per visual line, so a wrapped paragraph arrives as
 * six lines and the chunker would read each as its own block. Runs of three
 * or more newlines collapse to a paragraph break; trailing spaces go. Nothing
 * else is touched — the offsets the chunker records are into THIS string, and
 * it is this string that gets stored, so the two always agree.
 */
function normaliseWhitespace(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract text from a dropped file.
 *
 * PDFs go through pdf.js. Markdown and plain text are already text, and
 * pretending otherwise would be silly — they are read directly and reported
 * as a single page, which is exactly right for the characters-per-page
 * heuristic in extract.ts.
 */
export async function extractTextFromFile(file: File): Promise<RawExtraction> {
  if (typeof window === "undefined") throw new NotABrowserError();
  if (!isAcceptedFilename(file.name)) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  if (file.name.toLowerCase().endsWith(".pdf")) {
    return extractPdf(await file.arrayBuffer());
  }

  const text = normaliseWhitespace(await file.text());
  return { pageCount: 1, text };
}

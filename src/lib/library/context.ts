/**
 * A cited passage, with the document around it.
 *
 * A citation on screen is a quotation and an id. To check it against the
 * source you need what came before and after — and until now nothing in the
 * codebase could get from a chunk id back to its neighbours. This is that
 * lookup, and it is the whole data layer behind "see in source".
 *
 * WHAT THIS CANNOT DO, and the screen must not imply otherwise: the extracted
 * document text is never persisted. Ingestion chunks it and stores only the
 * chunks; R2 holds the original bytes, which are a PDF nobody can render here.
 * So context is STITCHED from adjacent chunks rather than sliced out of a
 * stored document. Chunks overlap by ~12%, so consecutive ones genuinely
 * abut — but this is a reconstruction of the surrounding section, not a page
 * image, and `source-dialog.tsx` says so in as many words.
 *
 * Chunk ids are `${documentId}#${ordinal}`, 0-based and gapless, so neighbours
 * are addressable with no index and no extra storage.
 */
import type { DocumentChunk, SafetyDocument } from "@/lib/schemas";

export interface PassageContext {
  /** The parent document, when the corpus still holds it. */
  readonly document: SafetyDocument | null;
  /** The chunk the citation names. */
  readonly chunk: DocumentChunk;
  /** Chunks immediately before it, in reading order. */
  readonly before: readonly DocumentChunk[];
  /** Chunks immediately after it, in reading order. */
  readonly after: readonly DocumentChunk[];
  /** 1-based, for "passage 3 of 41". */
  readonly position: number;
  readonly total: number;
}

/**
 * How many chunks either side to carry.
 *
 * One. Two would roughly triple the text in the dialog for a reader who came
 * to check one sentence, and the section heading already tells them where they
 * are. The point is to show the quotation is not floating free, not to
 * reproduce the document.
 */
export const CONTEXT_RADIUS = 1;

export function passageContext(
  chunks: readonly DocumentChunk[],
  documents: readonly SafetyDocument[],
  chunkId: string,
  radius: number = CONTEXT_RADIUS,
): PassageContext | null {
  const chunk = chunks.find((c) => c.id === chunkId);
  if (chunk === undefined) return null;

  // Ordinal order, not array order. The corpus is a merge of seeded and
  // uploaded documents and nothing promises the chunks arrive sorted.
  const siblings = chunks
    .filter((c) => c.documentId === chunk.documentId)
    .sort((a, b) => a.ordinal - b.ordinal);

  const index = siblings.findIndex((c) => c.id === chunk.id);
  if (index === -1) return null;

  return {
    document: documents.find((d) => d.id === chunk.documentId) ?? null,
    chunk,
    before: siblings.slice(Math.max(0, index - radius), index),
    after: siblings.slice(index + 1, index + 1 + radius),
    position: index + 1,
    total: siblings.length,
  };
}

/**
 * Where the verified span sits inside the chunk, or null when it does not.
 *
 * Returned as offsets rather than as pre-split strings so the caller renders
 * the chunk's own text and marks a range within it. The alternative — handing
 * back three fragments — would let a renderer reassemble them in a different
 * order or drop one, and the text on screen would no longer be the text that
 * was verified.
 *
 * Null when the span does not occur, and the caller renders the passage
 * unmarked. That is the same discipline the narrative highlighting already
 * uses: a span that no longer matches is dropped, never approximated.
 */
export function spanOffsets(
  text: string,
  span: string,
): { readonly start: number; readonly end: number } | null {
  if (span.length === 0) return null;
  const start = text.indexOf(span);
  if (start === -1) return null;
  return { start, end: start + span.length };
}

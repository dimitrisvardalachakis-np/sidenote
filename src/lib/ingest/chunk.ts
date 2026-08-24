/**
 * chunkDocument — turn extracted document text into retrievable passages.
 *
 * Pure TypeScript by requirement. No Node, no Cloudflare, no clock, no
 * randomness, no `Intl.Segmenter` (its availability on Workers is uneven, and
 * a chunker that silently segments differently in production than in tests is
 * worse than a simpler one). Cluster E calls this from a queue consumer, and
 * it must behave identically there.
 *
 * The central invariant, which several tests pin down:
 *
 *     source.slice(chunk.charStart, chunk.charEnd) === chunk.text
 *
 * Everything below works in offsets and slices the original string at the
 * end, rather than joining pieces together. Joining is how a chunker quietly
 * stops matching its own offsets — a space normalised here, a newline
 * collapsed there — and once that happens a citation points at the wrong
 * words, which in this application is the whole ballgame.
 */
import {
  ChunkId,
  type ChunkMeta,
  type DocumentChunk,
} from "@/lib/schemas";

export interface ChunkOptions {
  /** Passages aim for this size. Default 512, per CLAUDE.md. */
  readonly targetTokens?: number;
  /** Fraction of a chunk repeated at the start of the next. Default 0.12. */
  readonly overlapRatio?: number;
  /**
   * Last resort. A single sentence longer than this is split at word
   * boundaries.
   *
   * CLAUDE.md says never split mid-sentence, and this is the one deliberate
   * exception. A 3,000-token sentence with no internal break point does
   * occur in labels — long enumerations of adverse events joined by commas —
   * and emitting it whole means the embedder truncates it at 512 tokens and
   * everything past that becomes silently unretrievable by vector search.
   * Splitting it is visible and recoverable; truncation is neither. Set to
   * Infinity to honour the rule absolutely.
   */
  readonly hardSplitAtTokens?: number;
}

const DEFAULTS = {
  targetTokens: 512,
  overlapRatio: 0.12,
  hardSplitAtTokens: 1024,
} as const;

/** Longest section path we will record; DocumentChunk caps this at 300. */
const MAX_SECTION_LENGTH = 300;

/**
 * Rough token count.
 *
 * Four characters per token is the usual English approximation and it is
 * deterministic, which matters more here than accuracy: the real count comes
 * from the bge tokenizer at embed time, which is why the schema field is
 * called tokenEstimate rather than tokens.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : Math.ceil(trimmed.length / 4);
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

type UnitKind = "heading" | "sentence";

interface Unit {
  readonly kind: UnitKind;
  readonly start: number;
  readonly end: number;
  /** Heading depth; 1 is the outermost. Only meaningful for headings. */
  readonly level: number;
  /** Heading text with its markers stripped. Only meaningful for headings. */
  readonly title: string;
  /** True when this unit opens a new paragraph — a preferred break point. */
  readonly startsParagraph: boolean;
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "cf", "approx", "no", "fig", "tab", "eq",
  "dr", "prof", "mr", "mrs", "ms", "st", "al", "ca", "inc", "ltd", "co",
  "mg", "ml", "kg", "mcg", "iu", "hr", "min", "sec", "wk", "mo", "yr",
]);

/**
 * True when the full stop at `index` really ends a sentence.
 *
 * The cases that matter in safety documents: decimal doses ("0.5 mg"),
 * numbered sections ("4.8 Undesirable"), unit abbreviations ("50 mg. Given"),
 * and initials ("J. M. Smith"). Getting these wrong splits a sentence in the
 * middle, which is the one thing the brief forbids outright.
 */
function isSentenceEnd(text: string, index: number): boolean {
  const char = text[index];
  if (char !== "." && char !== "!" && char !== "?") return false;

  // Must be followed by whitespace or the end of the document.
  const next = text[index + 1];
  if (next !== undefined && !/\s/.test(next)) return false;

  if (char === "." ) {
    // A decimal point: digit, dot, digit.
    const before = text[index - 1];
    const after = text[index + 1];
    if (
      before !== undefined && /\d/.test(before) &&
      after !== undefined && /\d/.test(after)
    ) {
      return false;
    }

    // Walk back over the word immediately before the stop.
    let start = index;
    while (start > 0) {
      const c = text[start - 1];
      if (c === undefined || /[\s]/.test(c)) break;
      start -= 1;
    }
    const word = text.slice(start, index).toLowerCase().replace(/^[^a-z0-9.]+/, "");
    if (ABBREVIATIONS.has(word)) return false;
    // A single letter followed by a stop is an initial, not a sentence end.
    if (/^[a-z]$/.test(word)) return false;
    // "4.8" style section numbers reaching this point.
    if (/^\d+(\.\d+)*$/.test(word)) return false;
  }

  // Deliberately NOT requiring the next word to be capitalised.
  //
  // That rule looks reasonable and fails badly on the documents this reads:
  // converted PDFs lose casing, label text runs lowercase after a stop in
  // enumerations, and a sentence end that goes unrecognised is far worse than
  // one recognised too eagerly. An eager split lands on a full stop, which is
  // still a legal break point; a missed one glues a whole page into a single
  // oversized chunk. The checks above — decimals, abbreviations, initials,
  // section numbers — are what actually prevent a mid-sentence break.
  return true;
}

const ATX_HEADING = /^(#{1,6})\s+(\S.*?)\s*$/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)[.)]?\s+(\S.*?)\s*$/;

/**
 * Decide whether a line is a heading, and at what depth.
 *
 * Three forms, all of which occur in the documents this tool reads:
 *   `## 4.8 Undesirable effects`   markdown, from a converted file
 *   `4.8 Undesirable effects`      a CCDS section number
 *   `ADVERSE REACTIONS`            an FDA label, which shouts its headings
 */
function readHeading(line: string): { level: number; title: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const atx = ATX_HEADING.exec(trimmed);
  if (atx !== null) {
    const hashes = atx[1] ?? "";
    const rest = atx[2] ?? "";
    // A markdown heading that is itself numbered keeps the number in the
    // title, because "4.8 Undesirable effects" is how a reviewer cites it.
    return { level: hashes.length, title: rest };
  }

  // Headings are short and do not end in a full stop.
  if (trimmed.length > 90 || /[.;,]$/.test(trimmed)) return null;

  const numbered = NUMBERED_HEADING.exec(trimmed);
  if (numbered !== null) {
    const number = numbered[1] ?? "";
    const rest = numbered[2] ?? "";
    // Require the remainder to look like a title, not prose.
    if (rest.length > 0 && !/[.]$/.test(rest)) {
      return { level: number.split(".").length, title: trimmed };
    }
  }

  // All-caps, at least one letter, no lowercase.
  if (/[A-Z]/.test(trimmed) && !/[a-z]/.test(trimmed) && trimmed.length >= 3) {
    return { level: 1, title: trimmed };
  }

  return null;
}

/** Split the source into headings and sentences, tracking offsets. */
function segment(text: string, hardSplitAtTokens: number): Unit[] {
  const units: Unit[] = [];

  // Walk line by line so headings can be recognised, but let sentences run
  // across line breaks within a paragraph.
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  let blockStart: number | null = null;
  let blockStartsParagraph = true;
  let pendingParagraphBreak = true;

  const flushBlock = (end: number) => {
    if (blockStart === null) return;
    pushSentences(
      text,
      blockStart,
      end,
      blockStartsParagraph,
      hardSplitAtTokens,
      units,
    );
    blockStart = null;
  };

  for (let l = 0; l < lineStarts.length; l += 1) {
    const start = lineStarts[l] ?? 0;
    const nextStart = lineStarts[l + 1] ?? text.length + 1;
    const end = Math.min(nextStart - 1, text.length);
    const line = text.slice(start, end);

    if (line.trim().length === 0) {
      flushBlock(end);
      pendingParagraphBreak = true;
      continue;
    }

    const heading = readHeading(line);
    if (heading !== null) {
      flushBlock(start);
      const trimmedEnd = start + line.trimEnd().length;
      units.push({
        kind: "heading",
        start,
        end: trimmedEnd,
        level: heading.level,
        title: heading.title,
        startsParagraph: true,
      });
      pendingParagraphBreak = true;
      continue;
    }

    if (blockStart === null) {
      blockStart = start;
      blockStartsParagraph = pendingParagraphBreak;
      pendingParagraphBreak = false;
    }
  }
  flushBlock(text.length);

  return units;
}

/** Split one paragraph into sentence units, hard-splitting monsters. */
function pushSentences(
  text: string,
  from: number,
  to: number,
  startsParagraph: boolean,
  hardSplitAtTokens: number,
  out: Unit[],
): void {
  let cursor = from;
  let first = true;

  const emit = (start: number, end: number, opensParagraph: boolean) => {
    const slice = text.slice(start, end);
    if (slice.trim().length === 0) return;
    if (estimateTokens(slice) <= hardSplitAtTokens) {
      out.push({
        kind: "sentence",
        start,
        end,
        level: 0,
        title: "",
        startsParagraph: opensParagraph,
      });
      return;
    }
    // Last resort: break at word boundaries. See ChunkOptions.hardSplitAtTokens.
    const targetChars = hardSplitAtTokens * 4;
    let pieceStart = start;
    let scan = start;
    let lastSpace = -1;
    while (scan < end) {
      if (/\s/.test(text[scan] ?? "")) lastSpace = scan;
      if (scan - pieceStart >= targetChars && lastSpace > pieceStart) {
        out.push({
          kind: "sentence",
          start: pieceStart,
          end: lastSpace,
          level: 0,
          title: "",
          startsParagraph: pieceStart === start && opensParagraph,
        });
        pieceStart = lastSpace + 1;
        lastSpace = -1;
      }
      scan += 1;
    }
    if (pieceStart < end) {
      out.push({
        kind: "sentence",
        start: pieceStart,
        end,
        level: 0,
        title: "",
        startsParagraph: false,
      });
    }
  };

  for (let i = from; i < to; i += 1) {
    if (isSentenceEnd(text, i)) {
      emit(cursor, i + 1, first && startsParagraph);
      first = false;
      cursor = i + 1;
      while (cursor < to && /\s/.test(text[cursor] ?? "")) cursor += 1;
      i = cursor - 1;
    }
  }
  if (cursor < to) emit(cursor, to, first && startsParagraph);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Trim whitespace by moving the offsets, so the slice invariant survives. */
function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s] ?? "")) s += 1;
  while (e > s && /\s/.test(text[e - 1] ?? "")) e -= 1;
  return e > s ? { start: s, end: e } : null;
}

function sectionPathFrom(stack: readonly { title: string }[]): string | null {
  if (stack.length === 0) return null;
  const path = stack.map((h) => h.title).join(" › ");
  return path.length <= MAX_SECTION_LENGTH
    ? path
    : path.slice(path.length - MAX_SECTION_LENGTH);
}

/**
 * Split `text` into overlapping, structure-aware passages.
 *
 * Deterministic: the same text and meta always produce the same chunks with
 * the same ids. Ids are `${documentId}#${ordinal}` — readable in a citation,
 * which is where they end up, and stable because the chunking is.
 */
export function chunkDocument(
  text: string,
  meta: ChunkMeta,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const targetTokens = options.targetTokens ?? DEFAULTS.targetTokens;
  const overlapRatio = options.overlapRatio ?? DEFAULTS.overlapRatio;
  const hardSplitAtTokens =
    options.hardSplitAtTokens ?? DEFAULTS.hardSplitAtTokens;

  if (text.trim().length === 0) return [];

  const units = segment(text, hardSplitAtTokens);
  if (units.length === 0) return [];

  const overlapTokens = Math.max(0, Math.round(targetTokens * overlapRatio));
  const chunks: DocumentChunk[] = [];

  /** Heading stack as of the unit at each index, so overlap can be checked. */
  const headingStack: { level: number; title: string }[] = [];
  const sectionAt: (string | null)[] = [];
  for (const unit of units) {
    if (unit.kind === "heading") {
      while (
        headingStack.length > 0 &&
        (headingStack[headingStack.length - 1]?.level ?? 0) >= unit.level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level: unit.level, title: unit.title });
    }
    sectionAt.push(sectionPathFrom(headingStack));
  }

  let index = 0;
  let ordinal = 0;

  while (index < units.length) {
    const startUnit = units[index];
    if (startUnit === undefined) break;

    const chunkStartOffset = startUnit.start;
    let last = index;

    // Greedily take units while the chunk stays within target.
    //
    // A heading closes the previous chunk — but only once that chunk holds
    // actual content. Otherwise a document whose sections nest ("4 CLINICAL
    // PARTICULARS" immediately followed by "4.4 Special warnings") strands
    // each heading in a chunk of its own: six tokens of title, no prose, and
    // an embedding that retrieves nothing useful while still costing a slot
    // in every result list.
    let tookContent = false;
    for (let j = index; j < units.length; j += 1) {
      const unit = units[j];
      if (unit === undefined) break;
      if (unit.kind === "heading" && tookContent) break;

      const candidate = estimateTokens(text.slice(chunkStartOffset, unit.end));
      if (j > index && candidate > targetTokens) break;
      last = j;
      if (unit.kind === "sentence") tookContent = true;
    }

    // "Prefer paragraphs over sentences": if a paragraph opens late in this
    // chunk, break there instead of at the arbitrary sentence we ran out on.
    if (last > index && last + 1 < units.length) {
      for (let j = last; j > index; j -= 1) {
        const unit = units[j];
        if (unit === undefined) continue;
        if (!unit.startsParagraph) continue;
        const soFar = estimateTokens(text.slice(chunkStartOffset, unit.start));
        if (soFar >= targetTokens * 0.6) {
          last = j - 1;
          break;
        }
      }
    }

    const lastUnit = units[last];
    if (lastUnit === undefined) break;

    const range = trimRange(text, chunkStartOffset, lastUnit.end);
    if (range !== null) {
      const body = text.slice(range.start, range.end);
      chunks.push({
        id: ChunkId.parse(`${meta.documentId}#${ordinal}`),
        documentId: meta.documentId,
        sourceType: meta.sourceType,
        section: sectionAt[last] ?? null,
        ordinal,
        text: body,
        charStart: range.start,
        charEnd: range.end,
        tokenEstimate: estimateTokens(body),
      });
      ordinal += 1;
    }

    if (last + 1 >= units.length) break;

    // --- Overlap ---------------------------------------------------------
    // Walk back over whole units until we have roughly overlapTokens worth.
    // Never step back across a section change: bleeding one section's words
    // into another's chunk would attribute them to the wrong citation.
    let next = last + 1;
    if (overlapTokens > 0) {
      const nextSection = sectionAt[next] ?? null;
      // Overlap is whole sentences, so the requested ratio is a floor rather
      // than a target: one trailing sentence is the smallest step available.
      // In a document of long sentences that step can be most of a chunk, so
      // it is capped at half. Past that the two chunks are near-duplicates,
      // which wastes an embedding and returns the same passage twice in one
      // result list.
      const chunkTokens = estimateTokens(
        text.slice(chunkStartOffset, lastUnit.end),
      );
      const maxOverlapTokens = Math.floor(chunkTokens / 2);
      let accumulated = 0;
      let candidate = next;
      for (let j = last; j > index; j -= 1) {
        const unit = units[j];
        if (unit === undefined) break;
        if (unit.kind === "heading") break;
        if ((sectionAt[j] ?? null) !== nextSection) break;
        const unitTokens = estimateTokens(text.slice(unit.start, unit.end));
        if (accumulated + unitTokens > maxOverlapTokens) break;
        accumulated += unitTokens;
        candidate = j;
        if (accumulated >= overlapTokens) break;
      }
      next = candidate;
    }

    // Guarantee forward progress even if overlap wanted to rewind too far.
    index = next > index ? next : last + 1;
  }

  return chunks;
}

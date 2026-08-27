/**
 * Lexical retrieval over ingested chunks. Half of hybrid retrieval.
 *
 * CLAUDE.md specifies dense results fused with lexical results via Reciprocal
 * Rank Fusion. This module is the lexical half — BM25-style scoring over the
 * chunk text already mirrored into the library, in pure TypeScript because
 * there is no D1 FTS5 in this session. The dense half is `dense.ts`, and
 * `fuseByRank` below now genuinely gets two rankings on the reviewer path.
 *
 * Being explicit about what this half is and is not: it genuinely finds
 * passages and its citations are real chunks from real documents, but it is
 * not a semantic search. It will not connect "rash" to "erythema" unless a
 * synonym is listed below, and the table has 24 rows. That gap is what the
 * dense half closes — and the table is now a cheap fallback that also works
 * when no model is configured, rather than the ceiling on what can be found.
 *
 * WHERE IT IS STILL THE ONLY HALF. The intake chat (`conversation.ts`) is
 * lexical-only, and that is now a deliberate refusal rather than work not yet
 * done. It converts a bare retrieval hit into `alreadyDescribed`, which tells
 * a member of the public their reaction "does appear in the published
 * information" — with no model reading the passage. Every other surface puts a
 * model between the ranking and the claim; that one does not, so a better
 * retriever there would only assert more confidently. See NOTES.md.
 */
import type { Citation, DocumentChunk, SourceType } from "@/lib/schemas";

/** Words carrying no retrieval signal. Deliberately short. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for",
  "from", "had", "has", "have", "he", "her", "his", "i", "in", "is", "it",
  "its", "me", "my", "not", "of", "on", "or", "she", "that", "the", "their",
  "them", "there", "they", "this", "to", "was", "were", "with", "you", "your",
  "after", "before", "when", "very", "got", "get", "had",
]);

/**
 * Clinical wording a member of the public uses, mapped to the wording a label
 * uses. This is a deliberate stand-in for the embedding model: a reporter says
 * "rash", a CCDS says "erythema", and lexical search alone will never join
 * them. The list is short and honest about being incomplete — it exists so the
 * demo retrieves sensibly, not so anyone mistakes it for terminology coding.
 */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  rash: ["rash", "erythema", "eruption", "urticaria", "exanthema"],
  itchy: ["itch", "pruritus", "pruritic"],
  itch: ["itch", "pruritus", "pruritic"],
  swelling: ["swelling", "oedema", "edema", "angioedema"],
  swollen: ["swelling", "oedema", "edema", "angioedema"],
  breathless: ["dyspnoea", "dyspnea", "breathlessness"],
  breathlessness: ["dyspnoea", "dyspnea", "breathlessness"],
  breath: ["dyspnoea", "dyspnea", "breathlessness"],
  yellow: ["jaundice", "icterus", "yellow"],
  jaundiced: ["jaundice", "icterus"],
  sick: ["nausea", "vomiting"],
  queasy: ["nausea"],
  vomiting: ["vomiting", "emesis"],
  headache: ["headache", "cephalalgia"],
  dizzy: ["dizziness", "vertigo"],
  dizziness: ["dizziness", "vertigo"],
  liver: ["hepatic", "liver", "hepatotoxicity"],
  kidney: ["renal", "kidney", "nephrotoxicity"],
  fever: ["fever", "pyrexia", "febrile"],
  tired: ["fatigue", "asthenia"],
  fatigue: ["fatigue", "asthenia"],
  hives: ["urticaria", "hives"],
  bruising: ["bruising", "ecchymosis", "purpura"],
  bleeding: ["bleeding", "haemorrhage", "hemorrhage"],
};

/** Lowercase, strip punctuation, drop stopwords, crudely singularise. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(singularise);
}

function singularise(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && !word.endsWith("ses")) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Expand a query with the synonym table. Chunk text is NOT expanded. */
export function expandQuery(text: string): string[] {
  const expanded = new Set<string>();
  for (const token of tokenise(text)) {
    expanded.add(token);
    for (const synonym of SYNONYMS[token] ?? []) {
      expanded.add(singularise(synonym));
    }
  }
  return [...expanded];
}

export interface ScoredChunk {
  readonly chunk: DocumentChunk;
  readonly score: number;
  /** Query terms this chunk actually matched, for explaining a hit. */
  readonly matched: readonly string[];
}

export interface SearchOptions {
  readonly limit?: number;
  /** Restrict to one namespace. Company and public are never mixed by accident. */
  readonly sourceType?: SourceType;
  /** Hits below this are dropped. Guards against "everything matches 'the'". */
  readonly minScore?: number;
}

// BM25 constants. k1 controls term-frequency saturation, b length
// normalisation. These are the standard defaults and are not tuned — tuning
// them against twelve fixture documents would be fitting noise.
const K1 = 1.2;
const B = 0.75;

/**
 * Rank chunks against a query.
 *
 * Pure: same corpus and query always give the same ranking, which is what lets
 * the chat's verdict be tested.
 */
export function lexicalSearch(
  chunks: readonly DocumentChunk[],
  query: string,
  options: SearchOptions = {},
): readonly ScoredChunk[] {
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? 0.5;

  const corpus = options.sourceType
    ? chunks.filter((c) => c.sourceType === options.sourceType)
    : chunks;
  if (corpus.length === 0) return [];

  const terms = expandQuery(query);
  if (terms.length === 0) return [];

  const tokenised = corpus.map((chunk) => tokenise(chunk.text));
  const lengths = tokenised.map((t) => t.length);
  const averageLength =
    lengths.reduce((sum, n) => sum + n, 0) / Math.max(1, lengths.length);

  // Document frequency per term.
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenised) {
    const seen = new Set(tokens);
    for (const term of terms) {
      if (seen.has(term)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  const scored: ScoredChunk[] = [];
  for (const [index, chunk] of corpus.entries()) {
    const tokens = tokenised[index] ?? [];
    const length = lengths[index] ?? 0;
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const frequency = counts.get(term) ?? 0;
      if (frequency === 0) continue;
      matched.push(term);

      const df = documentFrequency.get(term) ?? 0;
      // BM25 idf, floored at zero so a term present in every chunk cannot
      // push a score negative.
      const idf = Math.max(
        0,
        Math.log(1 + (corpus.length - df + 0.5) / (df + 0.5)),
      );
      const denominator =
        frequency + K1 * (1 - B + (B * length) / Math.max(1, averageLength));
      score += idf * ((frequency * (K1 + 1)) / Math.max(1e-9, denominator));
    }

    if (score >= minScore) scored.push({ chunk, score, matched });
  }

  return scored
    .sort((a, b) =>
      b.score === a.score
        ? // Deterministic tie-break, so equal scores never reorder between runs.
          a.chunk.id.localeCompare(b.chunk.id)
        : b.score - a.score,
    )
    .slice(0, limit);
}

/**
 * Reciprocal Rank Fusion.
 *
 * The seam CLAUDE.md asks for, and it now gets both rankings on the reviewer
 * path: `assessCase` calls it with `[lexical, dense]`. RRF is used rather than
 * score averaging because BM25 scores and cosine similarities are not on
 * comparable scales, and averaging them silently lets whichever has the bigger
 * numbers win. Note that `hit.score` is never read below — only the index is —
 * which is what makes the two scales irrelevant rather than merely rescaled.
 *
 * THIS APPLIES NO LIMIT AND NO THRESHOLD. It returns every distinct chunk from
 * every ranking, so fusing two rankings of five can yield ten. Callers must
 * slice. With one ranking that was invisible, because the lexical search had
 * already capped itself; with two it is a silent doubling of everything
 * downstream. `assessCase` supplies the cap explicitly for exactly this reason.
 */
export function fuseByRank(
  rankings: readonly (readonly ScoredChunk[])[],
  k = 60,
): readonly ScoredChunk[] {
  const fused = new Map<string, { chunk: DocumentChunk; score: number; matched: Set<string> }>();

  for (const ranking of rankings) {
    for (const [index, hit] of ranking.entries()) {
      const existing = fused.get(hit.chunk.id);
      const contribution = 1 / (k + index + 1);
      if (existing === undefined) {
        fused.set(hit.chunk.id, {
          chunk: hit.chunk,
          score: contribution,
          matched: new Set(hit.matched),
        });
      } else {
        existing.score += contribution;
        for (const term of hit.matched) existing.matched.add(term);
      }
    }
  }

  return [...fused.values()]
    .map((entry) => ({
      chunk: entry.chunk,
      score: entry.score,
      matched: [...entry.matched],
    }))
    .sort((a, b) =>
      b.score === a.score
        ? a.chunk.id.localeCompare(b.chunk.id)
        : b.score - a.score,
    );
}

/** Turn a hit into the Citation shape the evidence panels already render. */
export function toCitation(hit: ScoredChunk): Citation {
  return {
    chunkId: hit.chunk.id,
    documentId: hit.chunk.documentId,
    sourceType: hit.chunk.sourceType,
    section: hit.chunk.section,
    // The quoted span. Trimmed to a readable length at the sentence boundary
    // rather than mid-word, because this string is shown to a member of the
    // public and a truncated word reads as a bug.
    quote: excerpt(hit.chunk.text, hit.matched),
  };
}

/**
 * A readable excerpt centred on the first matched term.
 *
 * Showing a whole 512-token chunk to a reporter is unreadable, and showing the
 * first 200 characters often misses the sentence that actually matched.
 */
export function excerpt(text: string, matched: readonly string[], max = 320): string {
  if (text.length <= max) return text;

  const first = matched[0];
  let centre = 0;
  if (first !== undefined) {
    const found = text.toLowerCase().indexOf(first);
    if (found >= 0) centre = found;
  }

  let start = Math.max(0, centre - Math.floor(max / 3));
  // Snap to a sentence start where one is nearby, so the excerpt does not
  // begin mid-clause.
  const sentenceStart = text.lastIndexOf(". ", start);
  if (sentenceStart >= 0 && start - sentenceStart < 120) start = sentenceStart + 2;

  let end = Math.min(text.length, start + max);
  const sentenceEnd = text.indexOf(". ", end - 60);
  if (sentenceEnd >= 0 && sentenceEnd < end + 80) end = sentenceEnd + 1;

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

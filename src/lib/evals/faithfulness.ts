/**
 * Faithfulness: does a generated reading say only what its passage supports?
 *
 * Two checks, and they are deliberately not the same kind of thing.
 *
 * THE VERBATIM CHECK IS A HARD GATE. A quoted span must occur in the chunk it
 * cites, character for character. This is not a quality metric with a
 * threshold — a fabricated quotation is not a regression in helpfulness, it is
 * a false statement about what a safety document says, attributed to that
 * document, in front of someone deciding whether to notify a regulator. There
 * is no score at which that is acceptable, so any failure fails the build.
 *
 * THE RATIONALE CHECK IS A SCORE. "Does the sentence exceed what the chunk
 * supports" cannot be decided mechanically — that would need the judgement the
 * reviewer is there to provide. What CAN be checked mechanically are the ways
 * a rationale demonstrably overreaches: asserting a determination the model is
 * not allowed to reach, recommending an action, or introducing substantive
 * terms that appear nowhere in the passage it claims to be reading. Those are
 * necessary conditions for faithfulness, not sufficient ones, and this module
 * says so rather than implying a rigour it does not have.
 */
import {
  containsRecommendation,
  isSingleSentence,
  RATIONALE_MAX_CHARS,
} from "@/lib/schemas/reading";
import type { DocumentChunk, ModelReading } from "@/lib/schemas";

/** Words that would be the model reaching a verdict rather than reading one. */
export const DETERMINATION_WORDS: readonly string[] = [
  "listed",
  "unlisted",
  "expected",
  "unexpected",
  "serious",
  "not serious",
  "expedited",
  "causal",
  "caused by",
];

export type FaithfulnessFailureKind =
  | "span_not_in_chunk"
  | "chunk_not_supplied"
  | "rationale_recommends"
  | "rationale_determines"
  | "rationale_unsupported_terms"
  | "rationale_too_long"
  | "rationale_multi_sentence";

export interface FaithfulnessFailure {
  readonly kind: FaithfulnessFailureKind;
  readonly detail: string;
  /**
   * True when this failure is a correctness bug rather than a quality one.
   * Only the verbatim family is fatal; see the note at the top of the file.
   */
  readonly fatal: boolean;
}

export interface FaithfulnessResult {
  readonly checked: number;
  readonly failures: readonly FaithfulnessFailure[];
  /** Fraction of readings with no failure of any kind. 1 when none checked. */
  readonly score: number;
  readonly fatalFailures: readonly FaithfulnessFailure[];
}

/** Tokens worth comparing: no stopwords, no punctuation, lowercase. */
const IGNORED = new Set([
  "the", "a", "an", "and", "or", "of", "in", "is", "are", "was", "were", "to",
  "for", "on", "at", "by", "with", "as", "that", "this", "it", "its", "from",
  "has", "have", "been", "be", "passage", "section", "document", "reports",
  "report", "reported", "records", "describes", "described", "states", "state",
  "lists", "list", "mentions", "notes", "says", "no", "not", "which", "there",
  "these", "those", "some", "any", "per", "cent", "percent",
  /*
    Structural vocabulary rather than claims. "The passage records jaundice as
    a rare event" asserts nothing about an "event" — that is just the word this
    domain uses for the thing that happened, and counting it as an unsupported
    term makes the check fire on its own house style. Kept short: every word
    added here is a word the check can no longer notice.
  */
  "event", "events", "case", "cases", "reaction", "reactions",
  "effect", "effects", "finding", "findings", "term", "terms",
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !IGNORED.has(w));
}

/**
 * Terms the rationale asserts that its passage never mentions.
 *
 * A crude proxy for "exceeds what the chunk supports", and honest about being
 * one: it compares stems, so "hepatic" in the rationale is satisfied by
 * "hepatic" in the chunk but not by "liver". That produces false alarms on
 * legitimate paraphrase, which is why it is scored rather than gated — a
 * rationale is dropped by the pipeline anyway if it overreaches in the ways
 * that can be decided, and this is here to make drift visible over a run.
 */
export function unsupportedTerms(
  rationale: string,
  chunkText: string,
): readonly string[] {
  const inChunk = new Set(contentTokens(chunkText));
  return contentTokens(rationale).filter((token) => {
    if (inChunk.has(token)) return false;
    // Accept a shared stem, so "elevations" matches "elevation".
    for (const known of inChunk) {
      if (known.startsWith(token.slice(0, 5)) || token.startsWith(known.slice(0, 5))) {
        return false;
      }
    }
    return true;
  });
}

export interface ScoredReading {
  readonly reading: ModelReading;
  /** Exactly the chunks that were put in the prompt for this reading. */
  readonly chunks: readonly DocumentChunk[];
}

/** Check one reading. Only `read` readings have anything to be faithful to. */
export function scoreReading(sample: ScoredReading): readonly FaithfulnessFailure[] {
  const { reading, chunks } = sample;
  if (reading.status !== "read") return [];

  const cited = chunks.find((c) => c.id === reading.chunkId);
  if (cited === undefined) {
    return [
      {
        kind: "chunk_not_supplied",
        detail: `reading cites ${reading.chunkId}, which was not among the passages supplied`,
        fatal: true,
      },
    ];
  }

  const failures: FaithfulnessFailure[] = [];

  // THE HARD GATE.
  if (!cited.text.includes(reading.quotedSpan)) {
    failures.push({
      kind: "span_not_in_chunk",
      detail: `quoted span does not occur in ${cited.id}: ${JSON.stringify(reading.quotedSpan.slice(0, 80))}`,
      fatal: true,
    });
  }

  const { rationale } = reading;
  if (rationale !== null) {
    if (containsRecommendation(rationale)) {
      failures.push({
        kind: "rationale_recommends",
        detail: `rationale recommends an action: ${JSON.stringify(rationale)}`,
        fatal: false,
      });
    }
    const lower = rationale.toLowerCase();
    const determination = DETERMINATION_WORDS.find((w) =>
      new RegExp(`\\b${w}`).test(lower),
    );
    if (determination !== undefined) {
      failures.push({
        kind: "rationale_determines",
        detail: `rationale reaches a determination ("${determination}"): ${JSON.stringify(rationale)}`,
        fatal: false,
      });
    }
    if (rationale.length > RATIONALE_MAX_CHARS) {
      failures.push({
        kind: "rationale_too_long",
        detail: `rationale is ${rationale.length} characters, cap is ${RATIONALE_MAX_CHARS}`,
        fatal: false,
      });
    }
    if (!isSingleSentence(rationale)) {
      failures.push({
        kind: "rationale_multi_sentence",
        detail: `rationale is more than one sentence: ${JSON.stringify(rationale)}`,
        fatal: false,
      });
    }
    const unsupported = unsupportedTerms(rationale, cited.text);
    if (unsupported.length > 0) {
      failures.push({
        kind: "rationale_unsupported_terms",
        detail: `rationale asserts terms absent from ${cited.id}: ${unsupported.join(", ")}`,
        fatal: false,
      });
    }
  }

  return failures;
}

/** Score a sample of generated readings. */
export function scoreFaithfulness(
  samples: readonly ScoredReading[],
): FaithfulnessResult {
  const readable = samples.filter((s) => s.reading.status === "read");
  const failures = samples.flatMap(scoreReading);
  const clean = readable.filter((s) => scoreReading(s).length === 0).length;

  return {
    checked: readable.length,
    failures,
    fatalFailures: failures.filter((f) => f.fatal),
    score: readable.length === 0 ? 1 : clean / readable.length,
  };
}

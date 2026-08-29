/**
 * Faithfulness: does a generated reading say only what its passage supports?
 *
 * Two checks, and they are deliberately not the same kind of thing.
 *
 * THE VERBATIM CHECK IS A HARD GATE, and it is non-negotiable #6. A quoted span must occur in the chunk it
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
  DETERMINATION_WORDS,
  isSingleSentence,
  RATIONALE_MAX_CHARS,
} from "@/lib/schemas/reading";
import { spanOccursIn } from "@/lib/assess/verify";
import type {
  DocumentChunk,
  GroundedNarrative,
  ModelReading,
} from "@/lib/schemas";
import { containsDetermination } from "@/lib/schemas/reading";

/*
  The determination vocabulary now lives beside the type it constrains, in
  `lib/schemas/reading.ts`, because the narrative *gates* on it where this
  module only scores it. Re-exported so existing importers of this module are
  unaffected and there is still exactly one list.
*/
export { DETERMINATION_WORDS };

export type FaithfulnessFailureKind =
  | "span_not_in_chunk"
  | "chunk_not_supplied"
  | "rationale_recommends"
  | "rationale_determines"
  | "rationale_unsupported_terms"
  | "rationale_too_long"
  | "rationale_multi_sentence"
  | "narrative_span_not_in_chunk"
  | "narrative_chunk_not_supplied"
  | "narrative_point_determines"
  | "narrative_point_recommends"
  | "narrative_duplicate_chunk"
  | "narrative_point_unsupported_terms";

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

  /*
    THE HARD GATE — and it must test exactly what the runtime tested.

    It now calls the same `spanOccursIn` the runtime calls, rather than a
    second copy of the comparison. The two copies once disagreed about what
    "verbatim" means — this one compared against the raw text while the runtime
    compared against the sanitised text — so a chunk containing the passage
    fence failed the build for quoting exactly what it had been shown. A gate
    that disagrees with the check it is guarding is worse than no gate: it
    fails honest work and teaches people to distrust it.
  */
  if (!spanOccursIn(cited, reading.quotedSpan)) {
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


// ---------------------------------------------------------------------------
// The narrative
//
// The fatal/non-fatal split here differs from the rationale's, and the
// difference is the whole point of scoring it separately.
//
// For a rationale, a determination is SCORED: the pipeline keeps a reading
// whose rationale it dropped, so a determination surviving into a sample is
// drift worth measuring, not a broken gate.
//
// For a narrative point, the pipeline drops the WHOLE POINT. A surviving point
// that recommends or determines therefore cannot mean the model misbehaved —
// it can only mean the gate did not run. That is a correctness bug in
// `verifyNarrative`, and it fails the build.
// ---------------------------------------------------------------------------

export interface ScoredNarrative {
  readonly narrative: GroundedNarrative;
  /** Exactly the chunks that were put in the prompt for this narrative. */
  readonly chunks: readonly DocumentChunk[];
}

/**
 * Check one narrative. Only `narrated` narratives have anything to be
 * faithful to — an `unavailable` one makes no claim about any document.
 */
export function scoreNarrative(
  sample: ScoredNarrative,
): readonly FaithfulnessFailure[] {
  const { narrative, chunks } = sample;
  if (narrative.status !== "narrated") return [];

  const failures: FaithfulnessFailure[] = [];
  const seen = new Set<string>();

  for (const point of narrative.points) {
    const cited = chunks.find((c) => c.id === point.chunkId);
    if (cited === undefined) {
      failures.push({
        kind: "narrative_chunk_not_supplied",
        detail: `point cites ${point.chunkId}, which was not among the passages supplied`,
        fatal: true,
      });
      continue;
    }

    // The same predicate the runtime used. See `spanOccursIn`.
    if (!spanOccursIn(cited, point.quotedSpan)) {
      failures.push({
        kind: "narrative_span_not_in_chunk",
        detail: `point span does not occur in ${cited.id}: ${JSON.stringify(point.quotedSpan.slice(0, 80))}`,
        fatal: true,
      });
    }

    if (seen.has(point.chunkId)) {
      failures.push({
        kind: "narrative_duplicate_chunk",
        detail: `two points cite ${point.chunkId}, which reads as two pieces of evidence where there is one`,
        fatal: false,
      });
    }
    seen.add(point.chunkId);

    if (containsRecommendation(point.sentence)) {
      failures.push({
        kind: "narrative_point_recommends",
        detail: `point recommends an action, which the gate should have dropped: ${JSON.stringify(point.sentence)}`,
        fatal: true,
      });
    }

    if (containsDetermination(point.sentence)) {
      failures.push({
        kind: "narrative_point_determines",
        detail: `point reaches a determination, which the gate should have dropped: ${JSON.stringify(point.sentence)}`,
        fatal: true,
      });
    }

    const unsupported = unsupportedTerms(point.sentence, cited.text);
    if (unsupported.length > 0) {
      failures.push({
        kind: "narrative_point_unsupported_terms",
        detail: `point asserts terms absent from ${cited.id}: ${unsupported.join(", ")}`,
        fatal: false,
      });
    }
  }

  return failures;
}

/** Score a sample of generated narratives. */
export function scoreNarrativeFaithfulness(
  samples: readonly ScoredNarrative[],
): FaithfulnessResult {
  const narrated = samples.filter((s) => s.narrative.status === "narrated");
  const failures = samples.flatMap(scoreNarrative);
  const clean = narrated.filter((s) => scoreNarrative(s).length === 0).length;

  return {
    checked: narrated.length,
    failures,
    fatalFailures: failures.filter((f) => f.fatal),
    score: narrated.length === 0 ? 1 : clean / narrated.length,
  };
}

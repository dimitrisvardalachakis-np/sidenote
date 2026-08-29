/**
 * The rules that decide whether a model's multi-point reply becomes a
 * narrative. Same discipline as `verify.ts`, applied per point.
 *
 * Two things differ from the single-reading path, and both are deliberate.
 *
 * A POINT IS DROPPED, THE REPLY IS NOT REJECTED. Three points arrive, one
 * quotes a sentence that does not occur in the passage it cites: that point is
 * discarded whole and the other two stand. They are individually exactly as
 * true as they would have been had the model returned only them. This is only
 * safe because `GroundedNarrative` has no top-level summary field — points are
 * independent claims, so a missing one leaves nothing dangling. If a summary
 * field is ever added, all-or-nothing becomes the only honest option, and the
 * two changes have to be made together.
 *
 * A BAD SENTENCE COSTS ITS CITATION, WHERE A BAD RATIONALE DOES NOT. On the
 * single-reading path `acceptableRationale` drops the sentence and keeps the
 * quotation, because the quotation is the evidence and it is still good. Here
 * the sentence and its citation ARE one point: dropping only the sentence
 * would leave a marker with nothing attached, which cannot render under
 * non-negotiable #3. The span is not lost either way — it is in the citation
 * list below the narrative.
 *
 * Nothing here repairs a reply. No span is trimmed until it matches, no
 * sentence is rewritten to remove a word.
 */
import { z } from "zod";
import type { DocumentChunk, GroundedNarrative } from "@/lib/schemas";
import {
  GroundedNarrative as GroundedNarrativeSchema,
  NARRATIVE_MAX_POINTS,
  NARRATIVE_POINT_MAX_CHARS,
  type NarrativePoint,
} from "@/lib/schemas/narrative";
import {
  containsDetermination,
  containsRecommendation,
  isSingleSentence,
} from "@/lib/schemas/reading";
import { isEmptySpan, spanOccursIn, unwrapFence, type Rejection } from "./verify";

/**
 * The literal shape asked for. Permissive about nulls for the same reason
 * `RawGeneration` is: a null inside a point should be reported as that point
 * being dropped for a named reason, not as a schema error about the whole
 * reply.
 */
export const RawNarrativePoint = z.object({
  chunkId: z.string().nullable(),
  quotedSpan: z.string().nullable(),
  sentence: z.string().nullable(),
});

export const RawNarrative = z.object({
  points: z.array(RawNarrativePoint),
});
export type RawNarrative = z.output<typeof RawNarrative>;

/** Why one point was discarded. Recorded on the audit line, never on screen. */
export type PointDropReason =
  | "missing_field"
  | "empty_span"
  | "unknown_chunk"
  | "duplicate_chunk"
  | "span_not_verbatim"
  | "sentence_empty"
  | "sentence_too_long"
  | "sentence_multi_sentence"
  | "sentence_recommends"
  | "sentence_determines";

export interface DroppedPoint {
  /** Position in the model's reply, so two drops of one kind stay distinct. */
  readonly index: number;
  readonly reason: PointDropReason;
  /** As the model sent it, for the audit line. Never used to look anything up. */
  readonly chunkId: string | null;
}

export type VerifyNarrativeResult =
  | {
      readonly ok: true;
      readonly narrative: GroundedNarrative;
      readonly dropped: readonly DroppedPoint[];
    }
  | {
      readonly ok: false;
      readonly rejection: Rejection;
      readonly dropped: readonly DroppedPoint[];
    };

export interface VerifyNarrativeInput {
  readonly raw: RawNarrative;
  /** Exactly the chunks that were put in the prompt. Nothing else is citable. */
  readonly chunks: readonly DocumentChunk[];
  readonly model: string;
  readonly gatewayRequestId: string | null;
  /** Passed in rather than read from the clock, so this stays pure. */
  readonly now: string;
}

/** Parse the reply into the raw shape, or say why it could not be. */
export function parseNarrative(
  text: string,
):
  | { readonly ok: true; readonly raw: RawNarrative }
  | { readonly ok: false; readonly rejection: Rejection } {
  const candidate = unwrapFence(text);

  let json: unknown;
  try {
    json = JSON.parse(candidate) as unknown;
  } catch {
    return {
      ok: false,
      rejection: { kind: "not_json", detail: "the reply was not a JSON object" },
    };
  }

  const parsed = RawNarrative.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        kind: "wrong_shape",
        detail: `the JSON did not match the required shape (${z.prettifyError(parsed.error).replace(/\s+/g, " ").slice(0, 200)})`,
      },
    };
  }
  return { ok: true, raw: parsed.data };
}

/** The sentence rules, in the order a drop should be reported. */
function sentenceProblem(sentence: string): PointDropReason | null {
  if (sentence.length === 0) return "sentence_empty";
  if (sentence.length > NARRATIVE_POINT_MAX_CHARS) return "sentence_too_long";
  if (!isSingleSentence(sentence)) return "sentence_multi_sentence";
  if (containsRecommendation(sentence)) return "sentence_recommends";
  if (containsDetermination(sentence)) return "sentence_determines";
  return null;
}

/**
 * Turn a parsed reply into a narrative, or refuse it.
 *
 * Note the ORDER of the per-point checks. The verbatim test runs before the
 * sentence content tests, so a point that both fabricates a quotation and
 * reaches a determination is always reported as `span_not_verbatim` — the
 * fabrication is the thing an operator needs to know about, and it is the more
 * serious of the two.
 */
export function verifyNarrative(
  input: VerifyNarrativeInput,
): VerifyNarrativeResult {
  const { raw, chunks, model, gatewayRequestId, now } = input;
  const dropped: DroppedPoint[] = [];

  /*
    Too many points is a whole-reply rejection, not a trim to the first three.

    Keeping three and discarding the rest would be repairing a reply until it
    matches the contract, which is the move this file and `verify.ts` both
    refuse. The count is part of the requested shape rather than a fact about
    any one point, and a model returning seven has demonstrated it is not
    following the contract — which is exactly when its quotations stop being
    worth trusting. The cost is real: three good points can be lost to a
    fourth. It is the right side to be wrong on.
  */
  if (raw.points.length > NARRATIVE_MAX_POINTS) {
    return {
      ok: false,
      rejection: {
        kind: "too_many_points",
        detail: `the reply offered ${raw.points.length} points; the contract allows at most ${NARRATIVE_MAX_POINTS}`,
      },
      dropped,
    };
  }

  const accepted: NarrativePoint[] = [];
  const usedChunks = new Set<string>();

  for (const [index, point] of raw.points.entries()) {
    const drop = (reason: PointDropReason) => {
      dropped.push({ index, reason, chunkId: point.chunkId });
    };

    if (
      point.chunkId === null ||
      point.quotedSpan === null ||
      point.sentence === null
    ) {
      drop("missing_field");
      continue;
    }

    // `"any text".includes("")` is true, so an empty span "occurs verbatim"
    // in every chunk ever sent. Checked before the chunk lookup because it is
    // cheaper and because it is the more embarrassing failure to render.
    if (isEmptySpan(point.quotedSpan)) {
      drop("empty_span");
      continue;
    }

    const cited = chunks.find((chunk) => chunk.id === point.chunkId);
    if (cited === undefined) {
      // A chunk id we did not send, discarded even when the quote is real
      // text from a different passage that we did send.
      drop("unknown_chunk");
      continue;
    }

    /*
      Two points on one passage read to a reviewer as two independent pieces
      of evidence when there is one. That is an overclaim, and a Set prevents
      it. The earlier point is kept and the later dropped — dropping a point
      whole, which is the sanctioned operation, rather than merging them.
    */
    if (usedChunks.has(cited.id)) {
      drop("duplicate_chunk");
      continue;
    }

    // THE verbatim check, against the chunk THIS point cites. Same predicate
    // as the single-reading path; see `spanOccursIn`.
    if (!spanOccursIn(cited, point.quotedSpan)) {
      drop("span_not_verbatim");
      continue;
    }

    const sentence = point.sentence.trim();
    const problem = sentenceProblem(sentence);
    if (problem !== null) {
      drop(problem);
      continue;
    }

    usedChunks.add(cited.id);
    accepted.push({
      // The chunk's own branded id, not the string the model sent. Equal by
      // the lookup above; using the trusted one keeps unvalidated strings out
      // of a branded type.
      chunkId: cited.id,
      quotedSpan: point.quotedSpan,
      sentence,
    });
  }

  if (accepted.length === 0) {
    /*
      Not a finding about the document. The caller turns this into
      `unavailable`, worded so it can never be read as "the passages say
      nothing" — that claim belongs to `ModelReading` and lives there alone.
    */
    return {
      ok: false,
      rejection: {
        kind: "no_points_survived",
        detail:
          raw.points.length === 0
            ? "the model offered no points"
            : `none of the ${raw.points.length} points offered could be verified against a passage`,
      },
      dropped,
    };
  }

  /*
    Run the result through its own schema before returning it, for the reason
    `verify.ts` gives: a backstop that never fires is not a backstop. A failure
    here is a bug in the checks above rather than a bad reply, so it is
    reported as a rejection and the reader gets the degraded state.
  */
  const parsed = GroundedNarrativeSchema.safeParse({
    status: "narrated",
    points: accepted,
    model,
    gatewayRequestId,
    generatedAt: now,
  });
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        kind: "wrong_shape",
        detail: `the narrative failed its own schema (${z.prettifyError(parsed.error).replace(/\s+/g, " ").slice(0, 160)})`,
      },
      dropped,
    };
  }

  return { ok: true, narrative: parsed.data, dropped };
}

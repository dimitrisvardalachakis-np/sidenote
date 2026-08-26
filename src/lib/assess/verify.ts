/**
 * The rules that decide whether a model's reply is allowed to become a
 * citation. All of them are enforced here, in code — none of them is left to
 * the prompt.
 *
 * That distinction is the whole point of this file. A prompt is a request; a
 * model that ignores it has still returned something, and something is what
 * ends up on a reviewer's screen. Every rule below is a check against the
 * bytes that actually came back, and every failure is a rejection rather than
 * a repair. In particular:
 *
 *   - a quoted span that does not occur in the chunk it cites is a fabricated
 *     quotation, and the whole reply is discarded
 *   - a chunk id we did not send is discarded, even if the quote is real
 *   - a rationale that recommends an action loses the rationale, not the
 *     citation, because the quotation was still verified
 *
 * Nothing here repairs a reply. Trimming a hallucinated quote until it matches,
 * or rewriting a rationale to remove the word "should", would be putting words
 * in the model's mouth and then attributing them to a document.
 */
import { z } from "zod";
import type { DocumentChunk, ModelReading } from "@/lib/schemas";
import {
  RATIONALE_MAX_CHARS,
  containsRecommendation,
  isSingleSentence,
} from "@/lib/schemas/reading";

/**
 * The literal shape the model is asked for. Deliberately permissive about
 * nulls: coherence between `found` and the other three is checked below, where
 * a mismatch can be reported as its own kind of failure rather than as a
 * generic schema error.
 */
export const RawGeneration = z.object({
  found: z.boolean(),
  chunkId: z.string().nullable(),
  quotedSpan: z.string().nullable(),
  rationale: z.string().nullable(),
});
export type RawGeneration = z.output<typeof RawGeneration>;

/** Why a reply was refused. Recorded on the audit line and used to word the retry. */
export type RejectionKind =
  | "not_json"
  | "wrong_shape"
  | "incoherent"
  | "unknown_chunk"
  | "span_not_verbatim";

export interface Rejection {
  readonly kind: RejectionKind;
  /** One line, safe to log and to put in the retry instruction. */
  readonly detail: string;
}

export type VerifyResult =
  | { readonly ok: true; readonly reading: ModelReading }
  | { readonly ok: false; readonly rejection: Rejection };

/**
 * Unwrap a markdown code fence, and nothing else.
 *
 * The instruction says no fences, and a fence is still a violation — but it is
 * a formatting slip, not a fabrication, and spending a second inference on it
 * buys nothing. So a fence that wraps the ENTIRE reply is peeled off.
 *
 * What this deliberately does NOT do is scan for the first `{` and hope. That
 * would accept prose with JSON buried in it, and "no prose" exists because a
 * model that is chatting is a model that is not following the schema — which
 * is exactly when its quotations stop being trustworthy.
 */
export function unwrapFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
}

/** Parse the reply into the raw shape, or say why it could not be. */
export function parseGeneration(
  text: string,
): { readonly ok: true; readonly raw: RawGeneration } | { readonly ok: false; readonly rejection: Rejection } {
  const candidate = unwrapFence(text);

  let json: unknown;
  try {
    json = JSON.parse(candidate) as unknown;
  } catch {
    return {
      ok: false,
      rejection: {
        kind: "not_json",
        detail: "the reply was not a JSON object",
      },
    };
  }

  const parsed = RawGeneration.safeParse(json);
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

export interface VerifyInput {
  readonly raw: RawGeneration;
  /** Exactly the chunks that were put in the prompt. Nothing else is citable. */
  readonly chunks: readonly DocumentChunk[];
  readonly model: string;
  readonly gatewayRequestId: string | null;
  /** Passed in rather than read from the clock, so this stays pure. */
  readonly now: string;
}

/**
 * Turn a parsed reply into a reading, or refuse it.
 *
 * Note the span is checked against the ONE chunk the model named, not against
 * any chunk in the set. That is stricter than it strictly has to be, and it is
 * the right strictness: a citation is a pairing of an id with a quote, and a
 * quote lifted from a different passage than the one cited is a mis-citation
 * even though both halves exist somewhere. A reviewer clicking through to
 * `company#12` has to find those words in `company#12`.
 */
export function verifyGeneration(input: VerifyInput): VerifyResult {
  const { raw, chunks, model, gatewayRequestId, now } = input;

  if (!raw.found) {
    // A "no" that also supplies a citation is not a coherent answer to the
    // question that was asked, and a model that is not answering coherently is
    // not one whose quotations should be trusted. Send it back.
    if (raw.chunkId !== null || raw.quotedSpan !== null) {
      return {
        ok: false,
        rejection: {
          kind: "incoherent",
          detail:
            'found was false but a chunkId or quotedSpan was still supplied',
        },
      };
    }
    return {
      ok: true,
      reading: {
        status: "nothing_found",
        model,
        gatewayRequestId,
        generatedAt: now,
      },
    };
  }

  if (raw.chunkId === null || raw.quotedSpan === null) {
    return {
      ok: false,
      rejection: {
        kind: "incoherent",
        detail: "found was true but chunkId or quotedSpan was null",
      },
    };
  }

  const cited = chunks.find((chunk) => chunk.id === raw.chunkId);
  if (cited === undefined) {
    return {
      ok: false,
      rejection: {
        kind: "unknown_chunk",
        detail: `chunkId ${JSON.stringify(raw.chunkId)} was not one of the passages supplied`,
      },
    };
  }

  // THE verbatim check. Exact substring, no normalisation of whitespace,
  // quotes or dashes — normalising here would mean the span we display is not
  // the span we verified, and the gap between the two is precisely where a
  // fabricated quotation would live.
  if (!cited.text.includes(raw.quotedSpan)) {
    return {
      ok: false,
      rejection: {
        kind: "span_not_verbatim",
        detail: `the quoted span does not occur in ${cited.id}`,
      },
    };
  }

  return {
    ok: true,
    reading: {
      status: "read",
      // The chunk's own id, not the string the model sent. They are equal by
      // the check above; using the trusted one means no unvalidated string
      // reaches the branded type.
      chunkId: cited.id,
      quotedSpan: raw.quotedSpan,
      rationale: acceptableRationale(raw.rationale),
      model,
      gatewayRequestId,
      generatedAt: now,
    },
  };
}

/**
 * Keep the rationale, or drop it and keep the citation.
 *
 * Dropping only the sentence is deliberate. The quotation has been verified
 * against the source; it is the evidence, and it is still good. The rationale
 * is a gloss on it, and a gloss that recommends an action, runs to three
 * sentences, or overruns the cap is one the reviewer is better off without.
 */
export function acceptableRationale(rationale: string | null): string | null {
  if (rationale === null) return null;
  const text = rationale.trim();
  if (text.length === 0) return null;
  if (text.length > RATIONALE_MAX_CHARS) return null;
  if (!isSingleSentence(text)) return null;
  if (containsRecommendation(text)) return null;
  return text;
}

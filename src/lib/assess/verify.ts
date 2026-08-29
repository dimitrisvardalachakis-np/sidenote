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
 * Non-negotiable #6 lives in this file.
 *
 * Nothing here repairs a reply. Trimming a hallucinated quote until it matches,
 * or rewriting a rationale to remove the word "should", would be putting words
 * in the model's mouth and then attributing them to a document.
 */
import { z } from "zod";
import type { DocumentChunk, ModelReading } from "@/lib/schemas";
import {
  ModelReading as ModelReadingSchema,
  RATIONALE_MAX_CHARS,
  containsRecommendation,
  isSingleSentence,
} from "@/lib/schemas/reading";
import { sanitisePassage } from "./prompt";

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

/**
 * THE verbatim check. One definition, three callers.
 *
 * Exact substring, against the SANITISED text, which is the string the model
 * was actually shown. No normalisation of whitespace, quotes or dashes —
 * normalising here would mean the span displayed is not the span verified, and
 * the gap between the two is precisely where a fabricated quotation would live.
 *
 * It is a function rather than an inline expression because there used to be
 * two copies of it, and they disagreed: the eval in `lib/evals/faithfulness.ts`
 * compared against the raw chunk text while the runtime compared against the
 * sanitised text, so a passage containing the fence failed the build for
 * quoting exactly what it had been given. The narrative verifier is the third
 * caller, and a third copy is how that recurs.
 */
export function spanOccursIn(chunk: DocumentChunk, span: string): boolean {
  return sanitisePassage(chunk.text).includes(span);
}

/**
 * A span of nothing is not a quotation.
 *
 * `"any text".includes("")` is true in JavaScript, so an empty string
 * "occurs verbatim" in every chunk ever sent — and a whitespace-only span
 * occurs in almost all of them. That is exactly the reply an 8B model gives
 * when it cannot copy a sentence exactly but has already committed to
 * found:true, and it would have rendered as an empty blockquote captioned
 * "checked to occur in it word for word".
 */
export function isEmptySpan(span: string): boolean {
  // `trim()` strips the Unicode whitespace class, which does NOT include
  // zero-width characters — "\u200b".trim().length is 1. Requiring a letter or
  // a digit is both simpler and stricter: a quotation with no alphanumeric
  // content is not a quotation, whatever invisible characters it contains.
  return !/[\p{L}\p{N}]/u.test(span);
}
export type RawGeneration = z.output<typeof RawGeneration>;

/** Why a reply was refused. Recorded on the audit line and used to word the retry. */
export type RejectionKind =
  | "not_json"
  | "wrong_shape"
  | "incoherent"
  | "unknown_chunk"
  | "span_not_verbatim"
  /*
    Narrative-only. Kept in this union rather than a parallel one so a caller
    joining `rejection.kind` values onto an audit line needs no change, and so
    there is one vocabulary for "why a model reply was refused".
  */
  | "too_many_points"
  | "no_points_survived";

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
  // `\s*` on both sides rather than a mandatory newline: a model that emits
  // ```json {"found": false, ...} ``` on one line has made the same trivial
  // formatting slip, and burning the only retry on it buys nothing.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
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
    return parsed(
      { status: "nothing_found", model, gatewayRequestId, generatedAt: now },
      "nothing_found",
    );
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

  if (isEmptySpan(raw.quotedSpan)) {
    return {
      ok: false,
      rejection: {
        kind: "incoherent",
        detail: "found was true but the quoted span was empty",
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

  // THE verbatim check — see `spanOccursIn` above for why it lives in one
  // place. For every real document the sanitised and raw texts are identical;
  // they differ only when a chunk contains the passage fence, and there the
  // model can only faithfully copy what was in front of it.
  if (!spanOccursIn(cited, raw.quotedSpan)) {
    return {
      ok: false,
      rejection: {
        kind: "span_not_verbatim",
        detail: `the quoted span does not occur in ${cited.id}`,
      },
    };
  }

  return parsed(
    {
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
    "read",
  );
}

/**
 * Run the reading through its own schema before returning it.
 *
 * Without this the schema was decoration: `verifyGeneration` built a bare
 * object literal, and nothing on the path from the model to the screen ever
 * parsed it. The rules attached to `ModelReading` — a non-empty span, a
 * rationale that does not recommend — only ever ran if something else happened
 * to parse an Assessment later. A backstop that never fires is not a backstop,
 * and the comments claiming one were wrong.
 *
 * A failure here is a bug in the checks above rather than a bad model reply,
 * so it is reported as a rejection and the reviewer sees the degraded state:
 * whatever went wrong, the one thing that must not happen is rendering it.
 */
function parsed(candidate: unknown, kind: string): VerifyResult {
  const result = ModelReadingSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      rejection: {
        kind: "wrong_shape",
        detail: `the ${kind} reading failed its own schema (${z.prettifyError(result.error).replace(/\s+/g, " ").slice(0, 160)})`,
      },
    };
  }
  return { ok: true, reading: result.data };
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

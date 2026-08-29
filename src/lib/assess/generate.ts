/**
 * One namespace in, one reading out.
 *
 * This is called at most twice per case — once for the company documents and
 * once for the public label — and never once per chunk. The whole retrieved
 * set for a namespace goes into a single prompt, because the question being
 * asked ("does any of this describe the reaction?") is a question about the
 * set. Asking it per chunk would multiply the cost by the retrieval depth and
 * would also make the model answer a question nobody asked, chunk by chunk,
 * with no way to prefer the better passage.
 *
 * At most two inferences per call: the attempt, and one retry with a stricter
 * instruction naming what was wrong. After that it gives up and returns
 * `unavailable`, which the screen renders as "assessment unavailable" and
 * never as "nothing found".
 */
import type {
  DocumentChunk,
  GroundedNarrative,
  ModelReading,
} from "@/lib/schemas";
import {
  AiTextResponse,
  GENERATION_MODEL,
  MAX_NARRATIVE_ATTEMPTS,
  MAX_OUTPUT_TOKENS,
  NARRATIVE_MAX_OUTPUT_TOKENS,
  TEMPERATURE,
  type AiBinding,
  type AiGatewayConfig,
  type AiRunOptions,
} from "./ai";
import {
  parseNarrative,
  verifyNarrative,
  type DroppedPoint,
} from "./narrative";
import { buildMessages, buildNarrativeMessages } from "./prompt";
import { parseGeneration, verifyGeneration, type Rejection } from "./verify";

/**
 * A model call that has not returned in this long is treated as a failure.
 *
 * Non-negotiable #5: AI failure must never block a human write. A hang is the
 * worst kind of failure for that rule, because it blocks without ever
 * reporting anything, so it is converted into an explicit outcome here.
 */
export const GENERATION_TIMEOUT_MS = 10_000;

export interface GenerateInput {
  /** Null when there is no Workers AI in this environment. */
  readonly binding: AiBinding | null;
  /** Why there is no binding. Shown to the reviewer when binding is null. */
  readonly unavailableReason: string;
  readonly gateway: AiGatewayConfig | null;
  readonly reactionTerm: string;
  readonly drugName: string;
  /** The fused hits for one namespace. Only these are citable. */
  readonly chunks: readonly DocumentChunk[];
  /** Injected so the result is reproducible in a test. */
  readonly now: string;
  readonly timeoutMs?: number | undefined;
}

export interface GenerateOutcome {
  readonly reading: ModelReading;
  /** One entry per inference actually made. Empty when none was. */
  readonly attempts: readonly AttemptRecord[];
}

export interface AttemptRecord {
  readonly attempt: number;
  readonly rejection: Rejection | null;
  readonly gatewayRequestId: string | null;
}

function unavailable(
  reason: string,
  model: string | null,
  gatewayRequestId: string | null,
  now: string,
): ModelReading {
  return {
    status: "unavailable",
    reason,
    model,
    gatewayRequestId,
    attemptedAt: now,
  };
}

/** The gateway half of a run's options, shared by both call sites. */
function gatewayOptions(gateway: AiGatewayConfig | null): AiRunOptions {
  return gateway === null
    ? {}
    : {
        gateway: {
          id: gateway.id,
          cacheTtl: gateway.cacheTtlSeconds,
          skipCache: gateway.skipCache,
        },
      };
}

/** Reject rather than hang. The binding has no AbortSignal in its surface. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`model call exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function readPassages(
  input: GenerateInput,
): Promise<GenerateOutcome> {
  const { binding, chunks, now } = input;
  const timeoutMs = input.timeoutMs ?? GENERATION_TIMEOUT_MS;

  if (binding === null) {
    return {
      reading: unavailable(input.unavailableReason, null, null, now),
      attempts: [],
    };
  }

  // A precondition, not a finding. With no passages there is nothing to read,
  // and the caller should have recorded `no_result` from retrieval instead.
  // Returning `nothing_found` here would attribute a conclusion to a model
  // that was never asked.
  if (chunks.length === 0) {
    return {
      reading: unavailable(
        "no passages were retrieved to read",
        GENERATION_MODEL,
        null,
        now,
      ),
      attempts: [],
    };
  }

  const options = gatewayOptions(input.gateway);

  const attempts: AttemptRecord[] = [];
  let retryDetail: string | null = null;

  // Two passes at most: the attempt, then one retry told exactly what failed.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const messages = buildMessages(
      {
        reactionTerm: input.reactionTerm,
        drugName: input.drugName,
        chunks,
      },
      retryDetail,
    );

    let raw: unknown;
    try {
      raw = await withTimeout(
        binding.run(
          GENERATION_MODEL,
          {
            messages,
            temperature: TEMPERATURE,
            max_tokens: MAX_OUTPUT_TOKENS,
          },
          options,
        ),
        timeoutMs,
      );
    } catch (cause) {
      // A transport failure is not a rejected reply; retrying a stricter
      // instruction at a model that did not answer is pointless. Stop.
      const message = cause instanceof Error ? cause.message : "unknown error";
      // Keep the gateway id if the runtime managed to set one. A timeout or a
      // 522 is precisely the case where an operator needs it: the request may
      // well have been logged upstream even though nothing came back.
      const failedId = binding.aiGatewayLogId ?? null;
      attempts.push({ attempt, rejection: null, gatewayRequestId: failedId });
      return {
        reading: unavailable(
          `the model could not be reached (${message})`,
          GENERATION_MODEL,
          failedId,
          now,
        ),
        attempts,
      };
    }

    const gatewayRequestId = binding.aiGatewayLogId ?? null;

    const envelope = AiTextResponse.safeParse(raw);
    if (!envelope.success) {
      const rejection: Rejection = {
        kind: "wrong_shape",
        detail: "the runtime returned no text response",
      };
      attempts.push({ attempt, rejection, gatewayRequestId });
      retryDetail = rejection.detail;
      continue;
    }

    const parsed = parseGeneration(envelope.data.response);
    if (!parsed.ok) {
      attempts.push({ attempt, rejection: parsed.rejection, gatewayRequestId });
      retryDetail = parsed.rejection.detail;
      continue;
    }

    const verified = verifyGeneration({
      raw: parsed.raw,
      chunks,
      model: GENERATION_MODEL,
      gatewayRequestId,
      now,
    });
    if (!verified.ok) {
      attempts.push({
        attempt,
        rejection: verified.rejection,
        gatewayRequestId,
      });
      retryDetail = verified.rejection.detail;
      continue;
    }

    attempts.push({ attempt, rejection: null, gatewayRequestId });
    return { reading: verified.reading, attempts };
  }

  // Both attempts were rejected. The reviewer is told the assessment is
  // unavailable — never that nothing was found, which would be a claim about
  // the document that nothing here established.
  const last = attempts[attempts.length - 1];
  return {
    reading: unavailable(
      `the model's reply could not be verified (${last?.rejection?.detail ?? "unknown reason"})`,
      GENERATION_MODEL,
      last?.gatewayRequestId ?? null,
      now,
    ),
    attempts,
  };
}


// ---------------------------------------------------------------------------
// The narrative: the same passages, read as a short account rather than as one
// quotation.
// ---------------------------------------------------------------------------

/** Identical inputs to a reading — the same passages, the same sanitisation. */
export type NarrateInput = GenerateInput;

export interface NarrateOutcome {
  /** Always a value: `narrated` or `unavailable`, never absent. */
  readonly narrative: GroundedNarrative;
  readonly attempts: readonly AttemptRecord[];
  /** Points the model offered that did not survive. For the audit line. */
  readonly dropped: readonly DroppedPoint[];
}

function narrativeUnavailable(
  reason: string,
  model: string | null,
  gatewayRequestId: string | null,
  now: string,
): GroundedNarrative {
  return {
    status: "unavailable",
    reason,
    model,
    gatewayRequestId,
    attemptedAt: now,
  };
}

/**
 * Two passes at most: the attempt, then one retry told exactly what failed.
 *
 * Every failure below produces `unavailable`, and the wording of each reason
 * matters more than usual: none of them may read as a statement about what the
 * documents contain. "No point could be verified against a passage" is a fact
 * about the model's reply. "The passages do not mention this" would be a
 * finding, and it is not one this function is in any position to make.
 *
 * A transport failure does NOT retry, for the reason `readPassages` gives:
 * sending a stricter instruction to a model that did not answer is pointless.
 */
export async function narratePassages(
  input: NarrateInput,
): Promise<NarrateOutcome> {
  const { binding, chunks, now } = input;
  const timeoutMs = input.timeoutMs ?? GENERATION_TIMEOUT_MS;

  if (binding === null) {
    return {
      narrative: narrativeUnavailable(input.unavailableReason, null, null, now),
      attempts: [],
      dropped: [],
    };
  }

  if (chunks.length === 0) {
    return {
      narrative: narrativeUnavailable(
        "no passages were retrieved to read",
        GENERATION_MODEL,
        null,
        now,
      ),
      attempts: [],
      dropped: [],
    };
  }

  const attempts: AttemptRecord[] = [];
  let dropped: readonly DroppedPoint[] = [];
  let retryDetail: string | null = null;

  // Two passes at most: the attempt, then one retry told exactly what failed.
  for (let attempt = 1; attempt <= MAX_NARRATIVE_ATTEMPTS; attempt += 1) {
    const messages = buildNarrativeMessages(
      {
        reactionTerm: input.reactionTerm,
        drugName: input.drugName,
        chunks,
      },
      retryDetail,
    );

    let raw: unknown;
    try {
      raw = await withTimeout(
        binding.run(
          GENERATION_MODEL,
          {
            messages,
            temperature: TEMPERATURE,
            max_tokens: NARRATIVE_MAX_OUTPUT_TOKENS,
          },
          gatewayOptions(input.gateway),
        ),
        timeoutMs,
      );
    } catch (cause) {
      // A transport failure is not a rejected reply; a stricter instruction to
      // a model that did not answer buys nothing. Stop.
      const message = cause instanceof Error ? cause.message : "unknown error";
      const failedId = binding.aiGatewayLogId ?? null;
      attempts.push({ attempt, rejection: null, gatewayRequestId: failedId });
      return {
        narrative: narrativeUnavailable(
          `the model could not be reached (${message})`,
          GENERATION_MODEL,
          failedId,
          now,
        ),
        attempts,
        dropped,
      };
    }

    // Read immediately after the call resolves and before anything else
    // awaits: a mutable property the runtime overwrites per call.
    const gatewayRequestId = binding.aiGatewayLogId ?? null;

    const envelope = AiTextResponse.safeParse(raw);
    if (!envelope.success) {
      const rejection: Rejection = {
        kind: "wrong_shape",
        detail: "the runtime returned no text response",
      };
      attempts.push({ attempt, rejection, gatewayRequestId });
      retryDetail = rejection.detail;
      continue;
    }

    const parsed = parseNarrative(envelope.data.response);
    if (!parsed.ok) {
      attempts.push({ attempt, rejection: parsed.rejection, gatewayRequestId });
      retryDetail = parsed.rejection.detail;
      continue;
    }

    const verified = verifyNarrative({
      raw: parsed.raw,
      chunks,
      model: GENERATION_MODEL,
      gatewayRequestId,
      now,
    });
    dropped = verified.dropped;
    if (!verified.ok) {
      attempts.push({
        attempt,
        rejection: verified.rejection,
        gatewayRequestId,
      });
      retryDetail = verified.rejection.detail;
      continue;
    }

    attempts.push({ attempt, rejection: null, gatewayRequestId });
    return { narrative: verified.narrative, attempts, dropped };
  }

  // Both attempts refused. The reader is told no account could be produced —
  // never that the documents say nothing, which is a claim nothing here made.
  const last = attempts[attempts.length - 1];
  return {
    narrative: narrativeUnavailable(
      `the narrative could not be verified (${last?.rejection?.detail ?? "unknown reason"})`,
      GENERATION_MODEL,
      last?.gatewayRequestId ?? null,
      now,
    ),
    attempts,
    dropped,
  };
}

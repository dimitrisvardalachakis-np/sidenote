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
import type { DocumentChunk, ModelReading } from "@/lib/schemas";
import {
  AiTextResponse,
  GENERATION_MODEL,
  MAX_OUTPUT_TOKENS,
  TEMPERATURE,
  type AiBinding,
  type AiGatewayConfig,
  type AiRunOptions,
} from "./ai";
import { buildMessages } from "./prompt";
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

  const options: AiRunOptions =
    input.gateway === null
      ? {}
      : {
          gateway: {
            id: input.gateway.id,
            cacheTtl: input.gateway.cacheTtlSeconds,
            skipCache: input.gateway.skipCache,
          },
        };

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

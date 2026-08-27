/**
 * Workers AI over HTTP, wearing the same interface as the native binding.
 *
 * WHY THIS EXISTS
 * `env.AI` only exists inside a Cloudflare Worker. Everything in this project
 * that generates — the assessment, the intake extraction, the public search
 * answer — was written against that binding and therefore could not run at
 * all outside Workers: not in `next dev`, not in a test against a real model,
 * not on any other host. The whole generation layer was correct, tested, and
 * unreachable.
 *
 * Workers AI also has a REST endpoint, and AI Gateway sits in front of it with
 * the same shape. So this implements `AiBinding` over `fetch`. The rest of the
 * codebase cannot tell the difference, which is the point: `readPassages` and
 * `extractReport` are unchanged, and the native binding stays the preferred
 * path when one is available.
 *
 * The two differ in exactly two ways, both handled here:
 *
 *   1. The REST body wraps the payload in `result`; the binding returns it
 *      bare. This unwraps, so callers see one shape.
 *   2. The gateway log id arrives as the `cf-aig-log-id` response header
 *      rather than as a property on the binding. This captures it and exposes
 *      it as `aiGatewayLogId`, so the audit line reads the same either way.
 */
import { z } from "zod";
import { fetchJsonWithHeaders, FetchJsonError } from "@/lib/fetch";
import type { AiBinding, AiRunOptions, TextGenerationInput } from "./ai";

/**
 * The REST envelope. Cloudflare returns 200 with `success: false` for some
 * failures, so the body is checked rather than the status alone — a 200 that
 * says it failed is still a failure, and treating it as a result would put an
 * empty reading on a reviewer's screen.
 */
const WorkersAiEnvelope = z.object({
  success: z.boolean(),
  result: z.unknown().nullable(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string() }))
    .default([]),
});

export interface HttpBindingConfig {
  readonly accountId: string;
  readonly apiToken: string;
  /** When set, calls route through AI Gateway instead of the direct API. */
  readonly gatewayId: string | null;
  /** Overridable so a test can point the real client at a local stub. */
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/** How long a single HTTP call may take before it is treated as a failure. */
export const HTTP_TIMEOUT_MS = 20_000;

/**
 * Where the call goes.
 *
 * With a gateway: through it, so caching, logging and the spend cap apply.
 * Without: straight at the API, which still works but gives up all three —
 * `resolveAiBinding` says so in its reason string rather than pretending.
 */
export function endpointFor(config: HttpBindingConfig, model: string): string {
  const base = config.baseUrl ?? null;
  if (base !== null) {
    return `${base.replace(/\/$/, "")}/${model}`;
  }
  return config.gatewayId === null
    ? `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${model}`
    : `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/workers-ai/${model}`;
}

class HttpAiBinding implements AiBinding {
  readonly #config: HttpBindingConfig;
  /**
   * Mutable, and matching the native binding's shape deliberately.
   *
   * `env.AI.aiGatewayLogId` is a property the runtime overwrites per call, and
   * `readPassages` reads it straight after awaiting. Mirroring that exactly —
   * including the mutability — means the two paths behave identically, and
   * `assessCase` already serialises its two calls precisely because this
   * property races when they overlap.
   */
  #lastLogId: string | null = null;

  constructor(config: HttpBindingConfig) {
    this.#config = config;
  }

  get aiGatewayLogId(): string | null {
    return this.#lastLogId;
  }

  async run(
    model: string,
    input: TextGenerationInput,
    options?: AiRunOptions,
  ): Promise<unknown> {
    this.#lastLogId = null;

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#config.apiToken}`,
      "content-type": "application/json",
    };

    // Gateway cache control travels as headers on the REST path, where the
    // native binding takes them as an options object.
    const gateway = options?.gateway;
    if (gateway !== undefined) {
      headers["cf-aig-cache-ttl"] = String(gateway.cacheTtl);
      if (gateway.skipCache) headers["cf-aig-skip-cache"] = "true";
    }

    let response: { data: z.output<typeof WorkersAiEnvelope>; headers: Headers };
    try {
      response = await fetchJsonWithHeaders(
        endpointFor(this.#config, model),
        WorkersAiEnvelope,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            messages: input.messages,
            temperature: input.temperature,
            max_tokens: input.max_tokens,
          }),
          signal: AbortSignal.timeout(this.#config.timeoutMs ?? HTTP_TIMEOUT_MS),
        },
      );
    } catch (cause) {
      // Re-thrown as a plain Error because generate.ts already converts any
      // throw into an `unavailable` reading with the message attached. The
      // FetchJsonError subclasses carry the useful detail; keep it.
      throw new Error(
        cause instanceof FetchJsonError
          ? `${cause.kind}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : "unknown transport failure",
        { cause },
      );
    }

    this.#lastLogId = response.headers.get("cf-aig-log-id");

    if (!response.data.success || response.data.result === null) {
      const detail =
        response.data.errors.map((e) => e.message).join("; ") || "no detail";
      throw new Error(`Workers AI reported failure: ${detail}`);
    }

    // Unwrap, so callers see the same `{ response }` the native binding gives.
    return response.data.result;
  }
}

export function createHttpAiBinding(config: HttpBindingConfig): AiBinding {
  return new HttpAiBinding(config);
}

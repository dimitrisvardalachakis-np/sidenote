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
import { fetchJsonWithHeaders, FetchJsonError, HttpError } from "@/lib/fetch";
import { isTextGeneration, type AiBinding, type AiRunInput, type AiRunOptions } from "./ai";

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
  /**
   * The gateway's own credential, when it has authentication switched on.
   *
   * SEPARATE FROM `apiToken`, because they authenticate to two different
   * things. `apiToken` is the provider credential the gateway forwards to
   * Workers AI; this one authorises the call to the GATEWAY, and a gateway
   * with Authenticated Gateway enabled rejects the request outright — 401,
   * internal code 2009 — before Workers AI is ever reached. There was no way
   * to send it, so an authenticated gateway was unreachable by construction:
   * the credentials worked perfectly against the direct API and every model
   * call in the app still failed.
   *
   * Null means the gateway is open and only the provider token is sent.
   */
  readonly gatewayToken: string | null;
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

/**
 * True when the URL `endpointFor` builds is the gateway's.
 *
 * `baseUrl` wins over the gateway — that is how the local stub is reached —
 * so "a gateway is configured" and "this call goes through the gateway" are
 * not the same question. Both the auth header and the failure message depend
 * on the second one, so it is asked once, here.
 */
function routedThroughGateway(config: HttpBindingConfig): boolean {
  return (config.baseUrl ?? null) === null && config.gatewayId !== null;
}

/**
 * What a gateway rejection means, in words somebody can act on.
 *
 * Worth the length, because the raw failure is actively misleading. It arrives
 * as `http: 401 Unauthorized from https://gateway.ai.cloudflare.com/…`, which
 * reads as "the credentials are wrong" — and they are not: the same account id
 * and token answer 200 against the direct API. The gateway refuses first, and
 * it returns the identical 401 for a gateway that does not exist, an account
 * that does not match, and a gateway whose authentication was never satisfied.
 * Those three are indistinguishable from outside, so all three are named
 * rather than guessed between.
 */
function describeGatewayRejection(
  config: HttpBindingConfig,
  status: number,
): string {
  const remedy =
    config.gatewayToken === null
      ? "set SIDENOTE_AI_GATEWAY_TOKEN to a token carrying the AI Gateway · Run permission"
      : "check that SIDENOTE_AI_GATEWAY_TOKEN carries the AI Gateway · Run permission";
  return (
    `AI Gateway rejected the request (${status}) before it reached Workers AI — ` +
    `the gateway refused, not the model. Check that a gateway named ` +
    `"${config.gatewayId ?? ""}" exists on account ${config.accountId}; if it has ` +
    `Authenticated Gateway switched on, ${remedy}. Unsetting SIDENOTE_AI_GATEWAY_ID ` +
    `calls Workers AI directly, at the cost of the cache, the log and the spend cap.`
  );
}

/**
 * The message a transport failure degrades into.
 *
 * Exported so the gateway case can be tested without a live 401, and separate
 * from `run` because it is a pure function of the failure and the config —
 * which is what makes it testable at all.
 */
export function describeTransportFailure(
  config: HttpBindingConfig,
  cause: unknown,
): string {
  if (
    routedThroughGateway(config) &&
    cause instanceof HttpError &&
    (cause.status === 401 || cause.status === 403)
  ) {
    return `http: ${describeGatewayRejection(config, cause.status)}`;
  }
  return cause instanceof FetchJsonError
    ? `${cause.kind}: ${cause.message}`
    : cause instanceof Error
      ? cause.message
      : "unknown transport failure";
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
    input: AiRunInput,
    options?: AiRunOptions,
  ): Promise<unknown> {
    this.#lastLogId = null;

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#config.apiToken}`,
      "content-type": "application/json",
    };

    /*
      Two credentials on one request, and they are not interchangeable.

      `authorization` is forwarded to Workers AI. `cf-aig-authorization` is
      consumed by the gateway itself and never reaches the provider. Sent only
      when the call actually goes through the gateway, so the local stub and
      the direct API are never handed a header they have no use for.
    */
    if (routedThroughGateway(this.#config) && this.#config.gatewayToken !== null) {
      headers["cf-aig-authorization"] = `Bearer ${this.#config.gatewayToken}`;
    }

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
          /*
            The whole difference between a generation and an embedding, on the
            wire. Everything else in this method — the URL, the gateway route,
            the envelope unwrap, the log-id header, the timeout, the
            FetchJsonError conversion — is identical for both, which is why
            this is a branch rather than a second client.
          */
          body: JSON.stringify(
            isTextGeneration(input)
              ? {
                  messages: input.messages,
                  temperature: input.temperature,
                  max_tokens: input.max_tokens,
                }
              : { text: input.text },
          ),
          signal: AbortSignal.timeout(this.#config.timeoutMs ?? HTTP_TIMEOUT_MS),
        },
      );
    } catch (cause) {
      // Re-thrown as a plain Error because generate.ts already converts any
      // throw into an `unavailable` reading with the message attached. The
      // FetchJsonError subclasses carry the useful detail; keep it.
      throw new Error(describeTransportFailure(this.#config, cause), { cause });
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

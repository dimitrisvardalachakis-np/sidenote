/**
 * The Workers AI boundary.
 *
 * The binding is described structurally rather than imported from
 * `@cloudflare/workers-types`, for two reasons. This module has to run under
 * `next dev` on Node, where no such binding exists and the whole point is to
 * degrade honestly; and the surface actually used here is three fields, so a
 * three-field interface documents the dependency better than a package does.
 *
 * `run` returns `unknown`. That is deliberate and matches `fetchJson`: the
 * model's reply is data arriving from outside, and `as T` would check nothing.
 * It is parsed with a schema before anything reads it.
 */
import { z } from "zod";
import { createHttpAiBinding } from "./http-binding";

/** Cluster C and E both name this model. It is recorded on every reading. */
export const GENERATION_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/**
 * Low, but not zero.
 *
 * Zero would be marginally more reproducible, but the retry in generate.ts is
 * a second chance at a reply that failed validation, and at zero the model
 * tends to reproduce the reply that just failed. A small amount of sampling
 * makes the second attempt a genuinely different draw. The strict verification
 * downstream is what makes low-but-nonzero safe: a worse sample is rejected,
 * never rendered.
 */
export const TEMPERATURE = 0.1;

/**
 * Enough for a quoted sentence, a one-sentence rationale and the JSON around
 * them, and not enough to ramble. A cap is also a spend cap: this is the
 * per-call ceiling that AI Gateway's budget in step 9 sits on top of.
 */
export const MAX_OUTPUT_TOKENS = 320;

export interface ChatTurn {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface TextGenerationInput {
  readonly messages: readonly ChatTurn[];
  readonly temperature: number;
  readonly max_tokens: number;
}

/**
 * AI Gateway routing.
 *
 * Every model call in this project goes through a gateway, for three reasons
 * CLAUDE.md names together in one row: caching, logging, and a spend cap.
 *
 * Caching is not a micro-optimisation here. The same case re-opened by a
 * second reviewer asks the same question of the same passages, and a cached
 * answer is not merely cheaper — it is the SAME answer, which matters when two
 * reviewers are comparing notes on one case. That is the central conflict this
 * app exists to resolve, so a cache that made them see different readings
 * would be actively harmful.
 */
export interface AiGatewayConfig {
  readonly id: string;
  readonly cacheTtlSeconds: number;
  readonly skipCache: boolean;
}

/**
 * One hour.
 *
 * Long enough that a case worked over a morning gives every reviewer the same
 * reading, short enough that re-ingesting a document is reflected the same day.
 * The cache key is the prompt, so an edited document changes the passages and
 * therefore the key — a stale reading cannot survive a re-chunk.
 */
export const GATEWAY_CACHE_TTL_SECONDS = 3600;

/**
 * The spend cap, as a per-request ceiling this code can actually enforce.
 *
 * AI Gateway's own budget limit is set in the dashboard and is the real cap;
 * it is not something a Worker can assert at call time. What this side can do
 * is bound the request: `MAX_OUTPUT_TOKENS` per call, at most two calls per
 * namespace and two namespaces per case, so one assessment cannot cost more
 * than four short completions no matter how badly the model behaves. A runaway
 * loop is the failure mode a dashboard budget catches late and a bounded retry
 * count prevents outright.
 */
export const MAX_CALLS_PER_ASSESSMENT = 4;

/**
 * Read the gateway configuration from the environment.
 *
 * Returns null when no gateway is configured, and null means the call is made
 * directly rather than not at all — a missing gateway must not take generation
 * down with it. It does mean no cache, no gateway log id, and no spend
 * ceiling, so it is worth being loud about in the audit line, which records
 * `gatewayRequestId: "none"` in that case.
 */
export function resolveGateway(
  env: Readonly<Record<string, unknown>>,
): AiGatewayConfig | null {
  const id = env["SIDENOTE_AI_GATEWAY_ID"];
  if (typeof id !== "string" || id.trim().length === 0) return null;
  return {
    id: id.trim(),
    cacheTtlSeconds: GATEWAY_CACHE_TTL_SECONDS,
    skipCache: env["SIDENOTE_AI_GATEWAY_SKIP_CACHE"] === "1",
  };
}

export interface AiRunOptions {
  readonly gateway?: {
    readonly id: string;
    readonly cacheTtl: number;
    readonly skipCache: boolean;
  };
}

/**
 * The shape of `env.AI` as this codebase uses it.
 *
 * `aiGatewayLogId` is populated by the runtime after a call routed through a
 * gateway. It is the id that ties a rendered assessment back to one inference,
 * which is what makes non-negotiable #9 mean something for AI output.
 */
export interface AiBinding {
  run(
    model: string,
    input: TextGenerationInput,
    options?: AiRunOptions,
  ): Promise<unknown>;
  readonly aiGatewayLogId?: string | null | undefined;
}

/** Workers AI text-generation returns `{ response }`. Verified, not asserted. */
export const AiTextResponse = z.object({ response: z.string() });

/**
 * How the app gets a model.
 *
 * Three outcomes, in preference order, and each one says truthfully what it
 * is so a degraded panel can explain itself:
 *
 *   1. `env.AI` — the native Workers binding. Fastest, no egress, no token to
 *      leak. Preferred whenever the app is running on Workers.
 *   2. An HTTP client against the Workers AI REST API, when an account id and
 *      token are configured. This is what lets the system run anywhere —
 *      `next dev`, a container, another host — which is the difference
 *      between a generation layer that exists and one that runs.
 *   3. Null, with a reason. Everything degrades honestly; nothing throws.
 *
 * The previous version of this function took a string map and returned null
 * unconditionally. It could not have returned a binding even in principle: an
 * `AiBinding` is an object with a method, and the parameter type was
 * `Record<string, string | undefined>`. No amount of configuration would have
 * changed its behaviour.
 */
export interface AiAvailability {
  readonly binding: AiBinding | null;
  /** Why there is no binding, in words a reviewer can read. */
  readonly reason: string | null;
  /** Which of the three outcomes happened. For the audit line and diagnostics. */
  readonly source: "workers-binding" | "http" | "none";
}

/** True when a value looks like the Workers AI binding rather than a string. */
function isAiBinding(value: unknown): value is AiBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { run?: unknown }).run === "function"
  );
}

function readString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * `env` is `unknown`-valued on purpose: it is handed either `process.env`
 * (all strings) or a Worker's `env` (strings AND bindings), and narrowing an
 * external shape at the boundary is the honest way to accept both.
 */
export function resolveAiBinding(
  env: Readonly<Record<string, unknown>>,
): AiAvailability {
  // An explicit off switch, checked first so it wins over any credentials
  // that happen to be present. Step 8's degraded walk depends on this.
  if (readString(env, "SIDENOTE_AI_DISABLED") === "1") {
    return {
      binding: null,
      reason: "generation is disabled by configuration",
      source: "none",
    };
  }

  const native = env["AI"];
  if (isAiBinding(native)) {
    return { binding: native, reason: null, source: "workers-binding" };
  }

  const accountId = readString(env, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = readString(env, "CLOUDFLARE_API_TOKEN");
  if (accountId !== null && apiToken !== null) {
    const gatewayId = readString(env, "SIDENOTE_AI_GATEWAY_ID");
    return {
      binding: createHttpAiBinding({
        accountId,
        apiToken,
        gatewayId,
        baseUrl: readString(env, "SIDENOTE_AI_BASE_URL") ?? undefined,
      }),
      reason: null,
      source: "http",
    };
  }

  // Say which half is missing. "It is not configured" sends somebody to read
  // the setup guide; "the token is missing" sends them to the right line of it.
  const missing =
    accountId === null && apiToken === null
      ? "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set"
      : accountId === null
        ? "CLOUDFLARE_ACCOUNT_ID is not set"
        : "CLOUDFLARE_API_TOKEN is not set";

  return {
    binding: null,
    reason: `no model is configured — ${missing}`,
    source: "none",
  };
}

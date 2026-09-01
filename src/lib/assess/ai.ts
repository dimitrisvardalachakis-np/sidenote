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

/**
 * Cluster C and E both name this model. It is recorded on every reading.
 *
 * `-fp8` since the first run against workerd, where the previous name —
 * `@cf/meta/llama-3.1-8b-instruct` — turned out to have been RETIRED:
 *
 *   5028: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30
 *
 * Three months before that run, and nothing in this repository noticed,
 * because every layer degraded exactly as designed: `generate.ts` caught the
 * transport error, returned `unavailable`, and the screen said the reading
 * could not be produced. Honest, and indistinguishable from the model simply
 * being down. The audit line said `status: "unavailable"` and nothing more
 * until the reason was added beside it — which is what turned a shrug into
 * this fix in one request.
 *
 * The same 8B family and size, so the failure modes the prompt and the
 * verifier are written against still apply — `verify.ts` reasons explicitly
 * about "the reply an 8B model gives", and a jump to a 70B would quietly
 * invalidate that reasoning rather than improve it.
 */
export const GENERATION_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

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

/**
 * The narrative's own output ceiling, and it is a LATENCY budget.
 *
 * A separate constant rather than a raised `MAX_OUTPUT_TOKENS`, because that
 * one is shared with the single-reading path and with `lib/extract/`. Both of
 * those provably fit in 320 and neither asked for more; raising it would more
 * than double their per-call spend ceiling as a side effect of a feature they
 * are not part of. Two constants also make the arithmetic writable — the worst
 * case for an assessment is `4 x 320 + 2 x 160`, which one number cannot say.
 *
 * IT WAS 700, AND 700 COULD NEVER RETURN. The old number was derived from the
 * shape of the reply — three points at ~148 tokens each is ~445, plus headroom
 * so a truncated string could not invalidate the JSON. Correct reasoning about
 * the wrong constraint. Measured from the live AI Gateway logs, this model
 * decodes at ~63 ms per output token:
 *
 *     30 tokens ->  1,975 ms      156 tokens ->  8,835 ms
 *     93 tokens ->  5,225 ms      214 tokens -> 13,587 ms
 *
 * which is `t = 63.1n + 80` to within a few percent. `GENERATION_TIMEOUT_MS`
 * is 10s, so the budget is ~158 tokens and 700 extrapolates to 35-45 seconds.
 * The narrative therefore could not finish inside its own timeout — not
 * flakily, arithmetically — and rendered "the model could not be reached"
 * every time, while the single reading survived on 30-93 tokens. Every layer
 * degraded exactly as designed, which is again why it went unnoticed.
 *
 * 160 IS NOT A FIX ON ITS OWN, and that is the part worth carrying. Capping
 * output while the prompt still asks for three points buys a reply truncated
 * mid-string instead of a timeout: invalid JSON, the retry spent, the same
 * `unavailable` screen reached faster. So the cap moves with the requested
 * shape — see NARRATIVE_MAX_POINTS and NARRATIVE_POINT_MAX_CHARS, which came
 * down in the same commit and for this reason. The timeout deliberately did
 * NOT go up: a fifteen-minute demo cannot absorb a forty-second pause, and a
 * short account that always appears beats a long one that never does.
 */
export const NARRATIVE_MAX_OUTPUT_TOKENS = 260;

export interface ChatTurn {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface TextGenerationInput {
  readonly messages: readonly ChatTurn[];
  readonly temperature: number;
  readonly max_tokens: number;
}

/** The embedding model. 768 dimensions, 512 input tokens, per CLAUDE.md. */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Workers AI embedding input. The array IS the batch — bge takes many texts
 * in one call, which is why ingestion does not make one request per chunk.
 */
export interface EmbeddingInput {
  readonly text: readonly string[];
}

/**
 * The two shapes `run` accepts.
 *
 * A union rather than a second binding, because the real `env.AI.run()` takes
 * both — one model id, one method, two payload shapes. Widening here means the
 * embedding path inherits everything the generation path already earned:
 * gateway routing, the `cf-aig-log-id` capture, the 200-with-`success:false`
 * case, and the timeout. A parallel client would have had to re-earn all four.
 */
export type AiRunInput = TextGenerationInput | EmbeddingInput;

/** True when this input is for a text-generation model rather than an embedder. */
export function isTextGeneration(
  input: AiRunInput,
): input is TextGenerationInput {
  return "messages" in input;
}

/**
 * The chat turns of an input, or none.
 *
 * Exists for the test fakes, which inspect the prompt they were handed and
 * used to reach straight for `input.messages`. Now that the input is a union
 * that access is unsound, and the honest repair is to narrow rather than to
 * cast: a fake handed an embedding input gets an empty list and behaves, where
 * a cast would have crashed on `.find`.
 */
export function messagesOf(input: AiRunInput): readonly ChatTurn[] {
  return isTextGeneration(input) ? input.messages : [];
}

/**
 * The embedding reply, after the binding has unwrapped `result`.
 *
 * Workers AI returns `{shape: [n, 768], data: [[...], ...]}`. `shape` is
 * dropped deliberately: it is redundant with `data.length`, and a second source
 * of truth about a count is a second thing to get wrong. The per-row length
 * check is the one that earns its place — it is what catches a silently swapped
 * model returning 384 dimensions into an index built for 768.
 */
export const AiEmbeddingResponse = z.object({
  data: z.array(z.array(z.number()).length(EMBEDDING_DIMENSIONS)).min(1),
});

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
 * The generation ceiling for one assessment.
 *
 * AI Gateway's own budget limit is set in the dashboard and is the real cap;
 * it is not something a Worker can assert at call time. What this side can do
 * is bound the request: `MAX_OUTPUT_TOKENS` per call, at most two calls per
 * namespace and two namespaces per case, so one assessment cannot cost more
 * than four short completions no matter how badly the model behaves. A runaway
 * loop is the failure mode a dashboard budget catches late and a bounded retry
 * count prevents outright.
 *
 * NOT THE TOTAL NUMBER OF INFERENCES. Since hybrid retrieval landed, an
 * assessment also spends `MAX_EMBEDDINGS_PER_ASSESSMENT` before any generation
 * runs. This constant is deliberately still about generations only, because it
 * bounds the retry loop in `generate.ts` and the two costs are not
 * interchangeable — an embedding is a different model at a different price,
 * and folding them into one number would make this bound mean nothing.
 */
export const MAX_READING_ATTEMPTS = 2;

/**
 * Two attempts at a narrative: one, then a stricter retry.
 *
 * This was 1, on the reasoning that partial acceptance makes outright failure
 * rare — a bad point is dropped and the rest stand, so a retry would be
 * re-rolling a dice that had already partly landed.
 *
 * Watching the real @cf/meta/llama-3.1-8b-instruct on this call showed that
 * reasoning to be wrong in a specific way. Partial acceptance only helps once
 * the reply PARSES; the model answered in prose instead of JSON, so no point
 * ever reached verification and the narrative never rendered at all. The audit
 * lines said so plainly — `points: 0, dropped: 0` — which is the signature of
 * a parse failure rather than a verification one.
 *
 * That is precisely what the single-reading path's retry has always been for,
 * and `narrativeRetryInstruction` names the failure rather than saying "try
 * again", for the reason its neighbour gives: a generic retry tends to
 * reproduce the reply that just failed.
 */
export const MAX_NARRATIVE_ATTEMPTS = 2;

export const NAMESPACES_PER_ASSESSMENT = 2;

/**
 * Two namespaces x (two reading attempts + one narrative attempt) = six.
 *
 * Written as the arithmetic rather than as `6`, so the ceiling changes when
 * one of its factors does instead of silently disagreeing with them.
 */
export const MAX_CALLS_PER_ASSESSMENT =
  NAMESPACES_PER_ASSESSMENT * (MAX_READING_ATTEMPTS + MAX_NARRATIVE_ATTEMPTS);

/**
 * The public search page asks one namespace, so its ceiling is half the above:
 * a reading, its retry, and one narrative.
 */
export const MAX_CALLS_PER_PUBLIC_ANSWER =
  MAX_READING_ATTEMPTS + MAX_NARRATIVE_ATTEMPTS;

/**
 * The embedding ceiling for one assessment: one, for the query.
 *
 * One rather than two because the query is the reaction term and it is
 * identical on the company and public sides, so `assessCase` embeds it once
 * and hands the vector to both namespace searches. Document embedding is not
 * counted here — that happens at ingestion, once per document, not per
 * assessment.
 */
export const MAX_EMBEDDINGS_PER_ASSESSMENT = 1;

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
    input: AiRunInput,
    options?: AiRunOptions,
  ): Promise<unknown>;
  readonly aiGatewayLogId?: string | null | undefined;
}

/** Workers AI text-generation returns `{ response }`. Verified, not asserted. */
/**
 * A model's reply, in either shape Workers AI returns.
 *
 * THIS WAS A REAL BUG, and an invisible one. The schema accepted only
 * `{ response }`, which is the shape `scripts/stub-model.mjs` emits — so every
 * test, every eval and every local run passed while the code could not read a
 * single word from the actual service. Workers AI answers
 * `@cf/meta/llama-3.1-8b-instruct` in the OpenAI-compatible shape:
 *
 *   { "result": { "choices": [ { "message": { "content": "…" } } ] } }
 *
 * Against the real model every reading came back `unavailable` with the
 * rejection "the runtime returned no text response" — the system degrading
 * honestly, exactly as designed, about a failure that was entirely its own.
 * It took fetching a real FDA label and watching a real inference fail to
 * find it, because the stub had been agreeing with the schema all along.
 *
 * The lesson is the one this project keeps relearning: a fake that is easier
 * to satisfy than the real thing is a fake that hides the difference. The stub
 * now emits the OpenAI shape for that reason.
 *
 * Both are accepted rather than the new one alone. The native `env.AI` binding
 * and some models still return `{ response }`, and a client that reads only
 * the shape it saw most recently is how this happened in the first place.
 */
const LegacyTextResponse = z.object({ response: z.string() });

const ChatTextResponse = z
  .object({
    choices: z
      .array(z.object({ message: z.object({ content: z.string() }) }))
      .min(1),
  })
  .transform((value) => {
    const first = value.choices[0];
    return { response: first === undefined ? "" : first.message.content };
  });

export const AiTextResponse = z.union([LegacyTextResponse, ChatTextResponse]);

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
        /*
          Only meaningful when the gateway has Authenticated Gateway switched
          on, and absent is the ordinary case — a gateway created from the
          dashboard is open by default and needs nothing here. It is read
          unconditionally rather than gated on `gatewayId`, so a token left in
          the environment after the gateway was removed is simply unused
          instead of being a second thing to remember to clear.
        */
        gatewayToken: readString(env, "SIDENOTE_AI_GATEWAY_TOKEN"),
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

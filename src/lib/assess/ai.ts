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

/** AI Gateway routing. Step 9 fills in the id and the spend cap. */
export interface AiGatewayConfig {
  readonly id: string;
  readonly cacheTtlSeconds: number;
  readonly skipCache: boolean;
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
 * which is what makes non-negotiable #6 mean something for AI output.
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
 * How the app gets a binding, and why it usually does not have one.
 *
 * There is no Cloudflare runtime in this session — no wrangler config, no
 * `env`, no bindings — so this returns null and every assessment degrades to
 * `unavailable`. That is the honest state, and step 8 is the proof that the
 * rest of the app keeps working in it.
 *
 * When the app moves onto Workers this becomes `getCloudflareContext().env.AI`
 * and nothing downstream changes: every function below takes the binding as an
 * argument, so there is exactly one line here to replace.
 */
export interface AiAvailability {
  readonly binding: AiBinding | null;
  /** Why there is no binding, in words a reviewer can read. */
  readonly reason: string | null;
}

export function resolveAiBinding(
  env: Readonly<Record<string, string | undefined>>,
): AiAvailability {
  // An explicit off switch, so step 8 can disable generation without
  // uninstalling anything. In the target architecture this is a KV feature
  // flag; the shape of the answer does not change when it moves.
  if (env["SIDENOTE_AI_DISABLED"] === "1") {
    return { binding: null, reason: "generation is disabled by configuration" };
  }
  return {
    binding: null,
    reason: "no Workers AI binding is configured in this environment",
  };
}

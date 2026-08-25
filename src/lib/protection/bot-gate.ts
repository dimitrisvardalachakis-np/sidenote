import "server-only";
import { z } from "zod";
import { fetchJson } from "@/lib/fetch";
import { getCloudflareEnv, readSetting } from "@/lib/platform/env";

/**
 * The bot check in front of the public form.
 *
 * CLAUDE.md specifies Turnstile, and Cluster C is where it stops being an
 * interface and starts being a request to Cloudflare. Both implementations
 * live here: the real one, and the permissive stub that runs when no secret is
 * configured.
 *
 * THE CHECK HAS THREE OUTCOMES, NOT TWO.
 *
 * "Passed" and "failed" are not enough, and this codebase already knows it:
 * ListednessFinding separates `no_result` from `source_unavailable` precisely
 * so that an outage cannot masquerade as a clean result. A bot gate has the
 * same hazard in a sharper form — if "siteverify was unreachable" collapses
 * into `ok: true`, the endpoint reports itself protected on a day it was not;
 * if it collapses into `ok: false`, a Cloudflare outage silently stops every
 * adverse-event report in the middle of a 15-day regulatory clock.
 *
 * So the gate reports what actually happened and does not decide what to do
 * about it. guard.ts owns that policy, in one visible place.
 */

export type BotCheck =
  /** siteverify ran and accepted the token. */
  | { readonly outcome: "passed" }
  /** siteverify ran and rejected the token. This caller is the problem. */
  | { readonly outcome: "failed"; readonly reason: string }
  /**
   * The check did not run, or could not reach a verdict. WE are the problem —
   * a missing secret, a bad secret, an outage. Deliberately not `failed`: the
   * caller did nothing wrong and must not be told they look like a robot.
   */
  | { readonly outcome: "unavailable"; readonly reason: string };

export interface BotGate {
  /** `token` is whatever the client widget produced. Null when it produced none. */
  verify(token: string | null, clientIp: string): Promise<BotCheck>;
}

/**
 * Lets everything through, and says why.
 *
 * Deliberately NOT called `DevBotGate` or `NoopBotGate`: the name is the
 * warning. It returns `unavailable` rather than `passed` because that is the
 * literal truth — no check ran — and because it makes a missing secret and a
 * Cloudflare outage take the same, audited path instead of one of them looking
 * like a pass.
 */
export class UnprotectedBotGate implements BotGate {
  async verify(_token: string | null, _clientIp: string): Promise<BotCheck> {
    return { outcome: "unavailable", reason: "no_turnstile_configured" };
  }
}

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's response. Anything else on the wire is a schema mismatch. */
const SiteVerifyResponse = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).default([]),
  hostname: z.string().optional(),
  challenge_ts: z.string().optional(),
  action: z.string().optional(),
  cdata: z.string().optional(),
});

/**
 * Error codes that mean OUR configuration is broken, not that the caller is a
 * robot. Turning any of these into a rejection would block real people for a
 * mistake they cannot see and cannot fix.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
const OUR_FAULT_CODES: ReadonlySet<string> = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
  "internal-error",
]);

/** siteverify is a single request to a nearby edge. It should never be slow. */
const SITEVERIFY_TIMEOUT_MS = 5_000;

export class TurnstileBotGate implements BotGate {
  readonly #secret: string;
  readonly #timeoutMs: number;

  constructor(secret: string, options?: { readonly timeoutMs?: number }) {
    this.#secret = secret;
    this.#timeoutMs = options?.timeoutMs ?? SITEVERIFY_TIMEOUT_MS;
  }

  async verify(token: string | null, clientIp: string): Promise<BotCheck> {
    // No token at all is a real rejection, not an outage: the widget is on the
    // page, so a submission arriving without one did not come from the page.
    if (token === null || token === "") {
      return { outcome: "failed", reason: "missing-input-response" };
    }

    let result: z.output<typeof SiteVerifyResponse>;
    try {
      result = await fetchJson(SITEVERIFY_URL, SiteVerifyResponse, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: this.#secret,
          response: token,
          // Turnstile checks this against the IP that solved the challenge.
          // clientIp() prefers CF-Connecting-IP, which is the only one here
          // that Cloudflare itself wrote and a client cannot forge.
          remoteip: clientIp,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // Every fetchJson failure is unavailability, including a schema
      // mismatch: if Cloudflare answered something we do not recognise, we
      // have no verdict, and inventing one in either direction is worse than
      // saying so.
      return {
        outcome: "unavailable",
        reason: error instanceof Error ? error.name : "unknown_error",
      };
    }

    if (result.success) return { outcome: "passed" };

    const codes = result["error-codes"];
    const reason = codes.length > 0 ? codes.join(",") : "rejected";

    // A misconfigured secret comes back as a plain failure. Treating it as one
    // would block every reporter until somebody noticed.
    if (codes.some((code) => OUR_FAULT_CODES.has(code))) {
      return { outcome: "unavailable", reason };
    }

    return { outcome: "failed", reason };
  }
}

/**
 * The line Cluster C changed.
 *
 * Async now, because the binding it reads is only reachable asynchronously
 * under the adapter. guard.ts was already async, so this cost nothing.
 *
 * Selection is on the SECRET, not on the runtime: a developer who puts a real
 * secret in .dev.vars should exercise the real gate under `next dev`, not a
 * stub that behaves differently from what ships.
 */
export async function getBotGate(): Promise<BotGate> {
  const env = await getCloudflareEnv();
  const secret = readSetting(env, "TURNSTILE_SECRET_KEY");
  if (secret === null) return new UnprotectedBotGate();
  return new TurnstileBotGate(secret);
}

/**
 * The site key, for the widget. Null means render no widget.
 *
 * Public by definition — it ships inside the page's markup. Kept beside the
 * gate so that "is Turnstile on?" has one answer on both sides: if a page ever
 * rendered a widget the server was not checking, the endpoint would look
 * protected and be wide open.
 */
export async function getTurnstileSiteKey(): Promise<string | null> {
  const env = await getCloudflareEnv();
  return readSetting(env, "TURNSTILE_SITE_KEY");
}

/** Named so the client and the server agree on the field. Turnstile's own. */
export const TURNSTILE_TOKEN_FIELD = "cf-turnstile-response";

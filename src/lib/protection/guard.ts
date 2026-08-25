import "server-only";
import { audit } from "@/lib/audit";
import { clientIp } from "./client-ip";
import { getBotGate } from "./bot-gate";
import type { RateLimiter } from "./rate-limit";
import { getConverseRateLimiter, getSubmitRateLimiter } from "./rate-limit";

/**
 * One check in front of everything the public can reach.
 *
 * Gathered here rather than repeated at each entry point, because there are
 * three of them (the form's action, the JSON route, and the intake chat) and
 * three copies of a security check is two copies waiting to fall behind.
 */

export type GuardResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "rate_limited" | "bot";
      readonly retryAfterSeconds: number;
      /** Plain wording. This is shown to a member of the public. */
      readonly message: string;
    };

/**
 * Who is calling, and therefore whether a bot check applies at all.
 *
 * Turnstile is a browser widget: it puts a token in a form. A partner system
 * posting JSON has no browser and cannot produce one, so treating its absent
 * token as a failed challenge would mean that switching Turnstile on switches
 * the machine endpoint off — and answers those callers with a message telling
 * them to reload a page they never loaded.
 *
 * So the caller says which it is, in a shape where "I forgot" does not compile
 * into "no token, therefore a robot".
 */
export type Caller =
  | { readonly kind: "browser"; readonly token: string | null }
  | { readonly kind: "machine" };

async function guard(
  limiter: RateLimiter,
  action: string,
  caller: Caller,
): Promise<GuardResult> {
  const ip = await clientIp();

  const decision = await limiter.check(`${action}:${ip}`);
  if (!decision.allowed) {
    audit({
      actor: "public",
      action: "rate_limited",
      target: action,
      outcome: "rejected",
      detail: { retryAfterSeconds: decision.retryAfterSeconds },
    });
    const minutes = Math.ceil(decision.retryAfterSeconds / 60);
    return {
      allowed: false,
      reason: "rate_limited",
      retryAfterSeconds: decision.retryAfterSeconds,
      message:
        minutes <= 1
          ? "That is a lot of messages in a short time. Please wait a minute and try again."
          : `That is a lot of messages in a short time. Please try again in about ${minutes} minutes.`,
    };
  }

  if (caller.kind === "machine") {
    // Not silent. This is the one path that skips the bot check entirely, so
    // the log has to show how often it is taken — a flood of these is somebody
    // discovering that posting JSON avoids the challenge.
    audit({
      actor: "public",
      action: "bot_check_not_applicable",
      target: action,
      outcome: "success",
      detail: { reason: "machine_caller" },
    });
    return { allowed: true };
  }

  const gate = await getBotGate();
  const check = await gate.verify(caller.token, ip);

  if (check.outcome === "failed") {
    audit({
      actor: "public",
      action: "bot_check_failed",
      target: action,
      outcome: "rejected",
      detail: { reason: check.reason },
    });
    return {
      allowed: false,
      reason: "bot",
      retryAfterSeconds: 0,
      message:
        "We could not tell that you are a person. Please reload the page and try again.",
    };
  }

  if (check.outcome === "unavailable") {
    // THE POLICY FOR "THE CHECK DID NOT RUN", IN ONE PLACE, ON PURPOSE.
    //
    // Two ways to be wrong here and they are not symmetric. Rejecting means a
    // missing secret or a Cloudflare wobble stops members of the public
    // reporting adverse drug reactions, each of which may carry a 15-day
    // regulatory clock that starts on the day we receive it — a report not
    // made is a report never made, and the person has no way to know it was
    // infrastructure rather than them. Allowing means junk reaches the
    // reviewer queue, where a human reads it, which is what happens to every
    // case anyway.
    //
    // So: allow, and never quietly. The rate limiter has already run and still
    // caps the volume, so this is not an open door.
    //
    // This is also the path the UnprotectedBotGate stub takes, which is the
    // point: a missing secret and a real outage produce the same audited line,
    // distinguished by `reason`. If `no_turnstile_configured` ever appears in
    // a deployed environment's logs, that is the alarm.
    audit({
      actor: "system",
      action: "bot_check_unavailable",
      target: action,
      outcome: "success",
      detail: { reason: check.reason },
    });
    return { allowed: true };
  }

  return { allowed: true };
}

/** In front of anything that writes a report. */
export async function guardPublicSubmission(
  caller: Caller,
): Promise<GuardResult> {
  return guard(await getSubmitRateLimiter(), "submit_report", caller);
}

/**
 * In front of the intake chat, which is chattier and gets a looser ceiling.
 *
 * Takes a token per turn rather than once per conversation, because a
 * Turnstile token is single use — siteverify answers `timeout-or-duplicate`
 * the second time it sees one — so "verify at the start and trust the rest"
 * is not a thing the product supports. The widget hands out a fresh token
 * after every send; see components/protection/turnstile.tsx.
 */
export async function guardPublicConversation(
  token: string | null,
): Promise<GuardResult> {
  return guard(await getConverseRateLimiter(), "intake_chat", {
    kind: "browser",
    token,
  });
}

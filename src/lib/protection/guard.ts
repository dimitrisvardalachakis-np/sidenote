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
    // WITH ONE EXCEPTION, AND IT IS THE ONE THAT WAS ACTUALLY OPEN.
    //
    // The reasoning above is about an OUTAGE: something transient, that we
    // did not choose, that will end. `no_turnstile_configured` is none of
    // those. It is the UnprotectedBotGate stub reporting that no secret was
    // ever set, and no amount of waiting fixes it — so in production it is not
    // a wobble to ride out, it is the bot gate having been off since the day
    // the app deployed, with the public layout telling every visitor the form
    // was protected.
    //
    // Treating those two as one state was the hole. They still produce the
    // same audit line so the alarm stays visible either way; what differs is
    // that in production the permanent one refuses.
    const unconfigured = check.reason === "no_turnstile_configured";
    const refuse = unconfigured && process.env.NODE_ENV === "production";

    audit({
      actor: "system",
      action: "bot_check_unavailable",
      target: action,
      outcome: refuse ? "rejected" : "success",
      detail: { reason: check.reason, refused: refuse },
    });

    if (refuse) {
      return {
        allowed: false,
        reason: "bot",
        retryAfterSeconds: 0,
        // Says it is us, not them. A reporter told "you look like a robot"
        // because of our missing secret would reasonably stop trying.
        message:
          "This form is not accepting reports just now because of a " +
          "configuration problem on our side. Please try again shortly.",
      };
    }

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

/**
 * In front of the public lookup, which costs real money to serve.
 *
 * `/report/search` is an unauthenticated GET, and answering one runs an
 * openFDA fetch, a chunking pass, an embedding call and up to four model
 * inferences. Nothing counted them. A loop over that URL was a bill, and the
 * AI Gateway spend cap was the only thing between a bored script and the
 * month's budget — a backstop that works by cutting every reviewer off too.
 *
 * NO BOT CHECK HERE, DELIBERATELY. A Turnstile challenge on a GET would break
 * linkability — the results page is meant to survive a bookmark and a shared
 * link, and that is worth keeping. The rate limit is the right instrument for
 * "this costs money"; the bot gate is the right instrument for "this writes
 * something", and this route writes nothing.
 */
export async function guardPublicSearch(): Promise<GuardResult> {
  return guard(await getConverseRateLimiter(), "public_search", {
    kind: "machine",
  });
}

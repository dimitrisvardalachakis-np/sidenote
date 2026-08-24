import "server-only";
import { audit } from "@/lib/audit";
import { clientIp } from "./client-ip";
import { getBotGate } from "./bot-gate";
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

async function guard(
  limiter: ReturnType<typeof getSubmitRateLimiter>,
  action: string,
  token: string | null,
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

  const check = await getBotGate().verify(token, ip);
  if (!check.ok) {
    audit({
      actor: "public",
      action: "bot_check_failed",
      target: action,
      outcome: "rejected",
      detail: { reason: check.reason ?? "unknown" },
    });
    return {
      allowed: false,
      reason: "bot",
      retryAfterSeconds: 0,
      message:
        "We could not tell that you are a person. Please reload the page and try again.",
    };
  }

  return { allowed: true };
}

/** In front of anything that writes a report. */
export function guardPublicSubmission(token: string | null): Promise<GuardResult> {
  return guard(getSubmitRateLimiter(), "submit_report", token);
}

/** In front of the intake chat, which is chattier and gets a looser ceiling. */
export function guardPublicConversation(): Promise<GuardResult> {
  return guard(getConverseRateLimiter(), "intake_chat", null);
}

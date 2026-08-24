import "server-only";
import { audit } from "@/lib/audit";

/**
 * The bot check in front of the public form.
 *
 * CLAUDE.md specifies Turnstile. Turnstile needs Cloudflare, which this
 * session does not have, so what exists here is the INTERFACE and a local
 * implementation that lets everything through.
 *
 * That is stated loudly on purpose. A permissive stub wearing the name of a
 * security control is worse than no control, because the next person reads the
 * call site, sees `await gate.verify(...)`, and believes the endpoint is
 * protected. So the local implementation is named for what it does, and it
 * writes an audit line every time it waves something through. If those lines
 * ever appear in a real environment, that is the alarm.
 */

export interface BotCheck {
  readonly ok: boolean;
  readonly reason: string | null;
}

export interface BotGate {
  /** `token` is whatever the client widget produced. Null when it produced none. */
  verify(token: string | null, clientIp: string): Promise<BotCheck>;
}

/**
 * Lets everything through, and says so in the audit log.
 *
 * Deliberately NOT called `DevBotGate` or `NoopBotGate`: the name is the
 * warning.
 */
export class UnprotectedBotGate implements BotGate {
  async verify(_token: string | null, clientIp: string): Promise<BotCheck> {
    audit({
      actor: "system",
      action: "bot_check_skipped",
      target: clientIp,
      outcome: "success",
      detail: { reason: "no_turnstile_configured" },
    });
    return { ok: true, reason: null };
  }
}

const gate: BotGate = new UnprotectedBotGate();

/**
 * The line Cluster C changes.
 *
 * The Turnstile implementation posts the token to
 * siteverify with the secret from the environment and returns its verdict.
 * Nothing at the call sites changes.
 */
export function getBotGate(): BotGate {
  return gate;
}

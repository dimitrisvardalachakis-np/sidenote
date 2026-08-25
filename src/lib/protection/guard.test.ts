import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCheck } from "./bot-gate";

/**
 * The guard's policy decisions, which are the ones with consequences.
 *
 * Three things are worth holding still here, and all three are decisions
 * rather than mechanisms:
 *
 *   1. A machine caller is not bot-checked. Turnstile is a browser widget, so
 *      requiring a token from a partner system means switching Turnstile on
 *      closes the JSON endpoint.
 *   2. "The check could not run" ALLOWS. Losing an adverse-event report to an
 *      infrastructure wobble is worse than letting junk reach a queue a human
 *      reads anyway.
 *   3. Every one of those paths is audited. Allowing quietly is the failure
 *      mode that looks like success for a year.
 */

const stub = vi.hoisted(() => ({
  verify: vi.fn<(token: string | null, ip: string) => Promise<BotCheck>>(),
  allow: true,
}));

vi.mock("./client-ip", () => ({
  clientIp: async () => "203.0.113.7",
}));

vi.mock("./bot-gate", () => ({
  getBotGate: async () => ({ verify: stub.verify }),
}));

vi.mock("./rate-limit", () => ({
  getSubmitRateLimiter: async () => ({
    check: async () => ({
      allowed: stub.allow,
      retryAfterSeconds: stub.allow ? 0 : 60,
    }),
  }),
  getConverseRateLimiter: async () => ({
    check: async () => ({
      allowed: stub.allow,
      retryAfterSeconds: stub.allow ? 0 : 60,
    }),
  }),
}));

const { guardPublicConversation, guardPublicSubmission } = await import(
  "./guard"
);

let logged: string[] = [];

function auditLines(): ReadonlyArray<Record<string, unknown>> {
  return logged
    .filter((line) => line.startsWith("[AUDIT] "))
    .map(
      (line) =>
        JSON.parse(line.slice("[AUDIT] ".length)) as Record<string, unknown>,
    );
}

beforeEach(() => {
  logged = [];
  stub.allow = true;
  stub.verify.mockReset();
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("guardPublicSubmission", () => {
  it("does not bot-check a machine caller, and records that it did not", async () => {
    const result = await guardPublicSubmission({ kind: "machine" });

    expect(result).toEqual({ allowed: true });
    // The point: configuring a Turnstile secret must not close this endpoint.
    expect(stub.verify).not.toHaveBeenCalled();
    expect(auditLines()).toContainEqual(
      expect.objectContaining({
        action: "bot_check_not_applicable",
        detail: { reason: "machine_caller" },
      }),
    );
  });

  it("bot-checks a browser caller and passes its token through", async () => {
    stub.verify.mockResolvedValue({ outcome: "passed" });

    const result = await guardPublicSubmission({
      kind: "browser",
      token: "a-token",
    });

    expect(result).toEqual({ allowed: true });
    expect(stub.verify).toHaveBeenCalledWith("a-token", "203.0.113.7");
  });

  it("turns a browser caller away when the check fails", async () => {
    stub.verify.mockResolvedValue({
      outcome: "failed",
      reason: "invalid-input-response",
    });

    const result = await guardPublicSubmission({
      kind: "browser",
      token: "stale",
    });

    expect(result).toMatchObject({ allowed: false, reason: "bot" });
    expect(auditLines()).toContainEqual(
      expect.objectContaining({
        action: "bot_check_failed",
        outcome: "rejected",
      }),
    );
  });

  it("ALLOWS when the check could not run, and says so loudly", async () => {
    stub.verify.mockResolvedValue({
      outcome: "unavailable",
      reason: "no_turnstile_configured",
    });

    const result = await guardPublicSubmission({
      kind: "browser",
      token: null,
    });

    expect(result).toEqual({ allowed: true });
    // If this line is ever missing, a deployment with no secret configured is
    // indistinguishable in the logs from one that is properly protected.
    expect(auditLines()).toContainEqual(
      expect.objectContaining({
        action: "bot_check_unavailable",
        detail: { reason: "no_turnstile_configured" },
      }),
    );
  });

  it("checks the rate limit BEFORE the bot gate", async () => {
    stub.allow = false;
    stub.verify.mockResolvedValue({ outcome: "passed" });

    const result = await guardPublicSubmission({
      kind: "browser",
      token: "a-token",
    });

    expect(result).toMatchObject({ allowed: false, reason: "rate_limited" });
    // siteverify is a network round trip. Making it for a caller we have
    // already decided to refuse is doing an attacker's work for them.
    expect(stub.verify).not.toHaveBeenCalled();
  });

  it("phrases the wait in minutes a person would use", async () => {
    stub.allow = false;
    const result = await guardPublicSubmission({ kind: "machine" });
    expect(result).toMatchObject({ allowed: false, reason: "rate_limited" });
    if (result.allowed) throw new Error("expected a refusal");
    expect(result.message).toContain("wait a minute");
    expect(result.message).not.toMatch(/\d+ seconds/);
  });
});

describe("guardPublicConversation", () => {
  it("bot-checks every turn, because a token is single use", async () => {
    stub.verify.mockResolvedValue({ outcome: "passed" });

    await guardPublicConversation("turn-one-token");
    await guardPublicConversation("turn-two-token");

    expect(stub.verify).toHaveBeenNthCalledWith(1, "turn-one-token", "203.0.113.7");
    expect(stub.verify).toHaveBeenNthCalledWith(2, "turn-two-token", "203.0.113.7");
  });
});

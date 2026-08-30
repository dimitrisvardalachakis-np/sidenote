import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileBotGate, UnprotectedBotGate } from "./bot-gate";

/**
 * The Turnstile gate, against a stubbed siteverify.
 *
 * These run through the real fetchJson and the real zod schema rather than
 * mocking them out, because the thing most worth proving is that a response
 * we do not recognise produces "unavailable" and not a verdict — and that only
 * happens if the schema actually runs.
 *
 * The distinction under test throughout: `failed` means the CALLER is the
 * problem and gets turned away; `unavailable` means WE are, and guard.ts lets
 * them through with an audit line rather than telling a member of the public
 * they look like a robot because our secret is wrong.
 */

const IP = "203.0.113.7";

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UnprotectedBotGate", () => {
  it("reports that no check ran, rather than reporting a pass", async () => {
    const check = await new UnprotectedBotGate().verify("anything", IP);
    // The whole point of the three-outcome type. If this ever returns
    // "passed", a deployment with no secret configured looks protected.
    expect(check).toEqual({
      outcome: "unavailable",
      reason: "no_turnstile_configured",
    });
  });
});

describe("TurnstileBotGate", () => {
  it("passes a token siteverify accepts", async () => {
    respondWith({ success: true, "error-codes": [] });
    const check = await new TurnstileBotGate("secret").verify("token", IP);
    expect(check).toEqual({ outcome: "passed" });
  });

  it("sends the secret, the token and the caller's ip", async () => {
    const fetchMock = vi.fn(
      async (
        _url: string | URL | Request,
        _init?: RequestInit,
      ): Promise<Response> =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new TurnstileBotGate("the-secret").verify("the-token", IP);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was never called");
    const [url, init] = call;

    expect(String(url)).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    // remoteip especially: Turnstile checks the token against the address that
    // solved the challenge, so sending the wrong one turns every real reporter
    // behind a proxy into a rejection.
    expect(JSON.parse(String(init?.body))).toEqual({
      secret: "the-secret",
      response: "the-token",
      remoteip: IP,
    });
  });

  it("fails a token siteverify rejects", async () => {
    respondWith({ success: false, "error-codes": ["invalid-input-response"] });
    const check = await new TurnstileBotGate("secret").verify("stale", IP);
    expect(check).toEqual({
      outcome: "failed",
      reason: "invalid-input-response",
    });
  });

  it("fails a reused token", async () => {
    respondWith({ success: false, "error-codes": ["timeout-or-duplicate"] });
    const check = await new TurnstileBotGate("secret").verify("spent", IP);
    expect(check.outcome).toBe("failed");
  });

  it("refuses a missing token without asking Cloudflare", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const gate = new TurnstileBotGate("secret");
    expect(await gate.verify(null, IP)).toEqual({
      outcome: "failed",
      reason: "missing-input-response",
    });
    expect(await gate.verify("", IP)).toEqual({
      outcome: "failed",
      reason: "missing-input-response",
    });
    // A round trip to be told what we already knew is a round trip an attacker
    // gets us to make for free.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats OUR bad secret as unavailable, not as a bot", async () => {
    respondWith({ success: false, "error-codes": ["invalid-input-secret"] });
    const check = await new TurnstileBotGate("wrong").verify("token", IP);
    // This is the one that matters most. A fat-fingered secret must not read
    // as "every member of the public is a robot today".
    expect(check).toEqual({
      outcome: "unavailable",
      reason: "invalid-input-secret",
    });
  });

  it("treats Cloudflare's own internal error as unavailable", async () => {
    respondWith({ success: false, "error-codes": ["internal-error"] });
    const check = await new TurnstileBotGate("secret").verify("token", IP);
    expect(check.outcome).toBe("unavailable");
  });

  it("is unavailable when siteverify cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const check = await new TurnstileBotGate("secret").verify("token", IP);
    expect(check.outcome).toBe("unavailable");
    expect(check).toMatchObject({ reason: "NetworkError" });
  });

  it("is unavailable when siteverify answers HTML", async () => {
    respondWith("<html>gateway</html>");
    const check = await new TurnstileBotGate("secret").verify("token", IP);
    expect(check).toEqual({
      outcome: "unavailable",
      reason: "MalformedJsonError",
    });
  });

  it("is unavailable when siteverify answers a shape we do not know", async () => {
    // Valid JSON, no `success` field. Under an `as T` cast this would read as
    // falsy and become a rejection — a real person turned away because
    // Cloudflare changed a field name.
    respondWith({ verdict: "ok" });
    const check = await new TurnstileBotGate("secret").verify("token", IP);
    expect(check).toEqual({
      outcome: "unavailable",
      reason: "SchemaMismatchError",
    });
  });

  it("is unavailable on a 5xx", async () => {
    respondWith({ success: false }, 503);
    const check = await new TurnstileBotGate("secret").verify("token", IP);
    expect(check).toEqual({ outcome: "unavailable", reason: "HttpError" });
  });

  it("gives up rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("timed out", "TimeoutError"));
            });
          }),
      ),
    );
    const gate = new TurnstileBotGate("secret", { timeoutMs: 10 });
    const check = await gate.verify("token", IP);
    expect(check.outcome).toBe("unavailable");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BindingRateLimiter,
  CONVERSE_BINDING_POLICY,
  SEARCH_BINDING_POLICY,
  InMemoryRateLimiter,
  SUBMIT_BINDING_POLICY,
} from "./rate-limit";

/**
 * The rate limiter, both halves.
 *
 * The last test in this file is the one that will actually save somebody:
 * the numbers in wrangler.jsonc and the numbers in rate-limit.ts are two
 * copies of the same policy, and two copies of anything drift. The binding is
 * what enforces, the constant is what the reporter is told to wait — so when
 * they disagree, the app confidently states a wrong number and nothing fails.
 */

function bindingReturning(success: boolean): RateLimit {
  return { limit: async () => ({ success }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BindingRateLimiter", () => {
  it("allows what the binding allows", async () => {
    const limiter = new BindingRateLimiter(
      bindingReturning(true),
      SUBMIT_BINDING_POLICY,
      "SUBMIT_RATE_LIMIT",
    );
    expect(await limiter.check("submit_report:1.2.3.4")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("blocks, and quotes the window it can actually promise", async () => {
    const limiter = new BindingRateLimiter(
      bindingReturning(false),
      SUBMIT_BINDING_POLICY,
      "SUBMIT_RATE_LIMIT",
    );
    // The binding reports `{ success }` and nothing else — no count, no reset
    // time — so the window length is the honest answer rather than a
    // precise-looking number we invented.
    expect(await limiter.check("submit_report:1.2.3.4")).toEqual({
      allowed: false,
      retryAfterSeconds: SUBMIT_BINDING_POLICY.windowSeconds,
    });
  });

  it("passes the caller's key through untouched", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const limiter = new BindingRateLimiter(
      { limit },
      SUBMIT_BINDING_POLICY,
      "SUBMIT_RATE_LIMIT",
    );
    await limiter.check("submit_report:203.0.113.7");
    expect(limit).toHaveBeenCalledWith({ key: "submit_report:203.0.113.7" });
  });

  it("fails OPEN when the binding itself throws, and says so", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });

    const limiter = new BindingRateLimiter(
      {
        limit: async () => {
          throw new Error("binding unavailable");
        },
      },
      SUBMIT_BINDING_POLICY,
      "SUBMIT_RATE_LIMIT",
    );

    // A limiter that is itself down has no availability left to protect, and
    // refusing adverse-event reports during an infrastructure wobble loses
    // reports that carry a regulatory clock.
    expect(await limiter.check("submit_report:1.2.3.4")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    // Open, but never quietly.
    const audit = logged.find((line) => line.startsWith("[AUDIT]"));
    expect(audit).toBeDefined();
    expect(JSON.parse(String(audit).slice("[AUDIT] ".length))).toMatchObject({
      action: "rate_limit_unavailable",
      target: "SUBMIT_RATE_LIMIT",
    });
  });
});

describe("InMemoryRateLimiter", () => {
  it("still enforces its window, for local development", async () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowSeconds: 600 });
    expect((await limiter.check("k")).allowed).toBe(true);
    expect((await limiter.check("k")).allowed).toBe(true);

    const third = await limiter.check("k");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it("counts each key separately", async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowSeconds: 600 });
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("b")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);
  });
});

/**
 * Strips // and /* comments from JSONC, ignoring anything inside a string.
 *
 * Written out rather than regexed because a naive regex eats the `//` in a URL
 * and turns a passing test into a confusing one.
 */
function stripJsonComments(source: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

interface WranglerRateLimit {
  readonly name: string;
  readonly namespace_id: string;
  readonly simple: { readonly limit: number; readonly period: number };
}

describe("wrangler.jsonc and the policy constants", () => {
  const raw = readFileSync(
    fileURLToPath(new URL("../../../wrangler.jsonc", import.meta.url)),
    "utf8",
  );
  const config = JSON.parse(stripJsonComments(raw)) as {
    readonly ratelimits?: readonly WranglerRateLimit[];
  };
  const byName = new Map(
    (config.ratelimits ?? []).map((entry) => [entry.name, entry]),
  );

  it("binds every limiter the guards reach for", () => {
    expect([...byName.keys()].sort()).toEqual([
      "CONVERSE_RATE_LIMIT",
      "SEARCH_RATE_LIMIT",
      "SUBMIT_RATE_LIMIT",
    ]);
  });

  /*
    The public lookup is the expensive one and must not share the chat's
    number. Answering a search runs an openFDA fetch, a chunking pass, an
    embedding and up to four inferences; a chat turn costs at most two. It
    borrowed the chat's limiter until now, which is why eight rapid GETs
    against the deployed app all returned 200 — twenty a minute was never
    approached.
  */
  it("gives the search a tighter ceiling than the chat", () => {
    expect(SEARCH_BINDING_POLICY.limit).toBeLessThan(
      CONVERSE_BINDING_POLICY.limit,
    );
  });

  it.each([
    ["SUBMIT_RATE_LIMIT", SUBMIT_BINDING_POLICY],
    ["CONVERSE_RATE_LIMIT", CONVERSE_BINDING_POLICY],
    ["SEARCH_RATE_LIMIT", SEARCH_BINDING_POLICY],
  ])("%s matches its policy constant", (name, policy) => {
    const bound = byName.get(name);
    expect(bound).toBeDefined();
    // If this fails, the app is telling reporters to wait a length of time
    // that has nothing to do with what the edge is enforcing.
    expect(bound?.simple.limit).toBe(policy.limit);
    expect(bound?.simple.period).toBe(policy.windowSeconds);
  });

  it("uses a period Cloudflare actually supports", () => {
    // The binding accepts 10 or 60 and rejects everything else at deploy time.
    // Catching it here costs a second; catching it at deploy costs a deploy.
    for (const entry of config.ratelimits ?? []) {
      expect([10, 60]).toContain(entry.simple.period);
    }
  });

  it("gives each limiter its own namespace", () => {
    const ids = (config.ratelimits ?? []).map((entry) => entry.namespace_id);
    // A shared namespace would have the chat's traffic eating the form's
    // allowance, so the two ceilings would silently become one.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

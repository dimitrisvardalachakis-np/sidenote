import "server-only";
import { audit } from "@/lib/audit";
import { getCloudflareEnv } from "@/lib/platform/env";

/**
 * Rate limiting for the endpoints anyone can reach.
 *
 * CLAUDE.md puts a Turnstile plus a rate-limit binding in front of the public
 * report form. Cluster C is where the binding arrives; the in-memory limiter
 * stays behind it for local development, where there is no binding and a Map
 * in one process is genuinely the whole world.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** How long to wait, for the Retry-After header and the message. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

export interface WindowPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * THE POLICY WE WANT.
 *
 * Submitting a safety report is a deliberate act that takes minutes, so the
 * ceiling can be low without ever troubling a real person. Reading is cheaper
 * and gets a looser one.
 */
export const SUBMIT_POLICY: WindowPolicy = { limit: 5, windowSeconds: 600 };
export const CONVERSE_POLICY: WindowPolicy = { limit: 60, windowSeconds: 600 };

/**
 * THE POLICY THE BINDING CAN ACTUALLY EXPRESS, AND WHY IT IS DIFFERENT.
 *
 * Cloudflare's rate-limit binding takes a period of 10 or 60 seconds. Not 600.
 * That is a hard constraint of the product, not a configuration we have not
 * got round to, so the ten-minute ceiling above is NOT enforceable by this
 * binding and pretending otherwise in a comment would be the useful kind of
 * lie — the kind nobody notices for a year.
 *
 * What is lost, stated plainly: a script that paces itself at five submissions
 * a minute now gets fifty in ten minutes where the intended policy allowed
 * five. What is kept: the burst, which is the shape actual abuse takes, and
 * which is what stops a form being hammered.
 *
 * The sustained ceiling needs a counter that outlives a 60-second window and
 * is shared across isolates. That is a Durable Object, which CLAUDE.md assigns
 * to Cluster D. Building one here would be Cluster C quietly creating the
 * storage layer the next cluster is supposed to build deliberately.
 *
 * These numbers MUST match the `ratelimits` block in wrangler.jsonc.
 * rate-limit.test.ts reads that file and fails if they ever drift.
 */
export const SUBMIT_BINDING_POLICY: WindowPolicy = { limit: 5, windowSeconds: 60 };
export const CONVERSE_BINDING_POLICY: WindowPolicy = {
  limit: 20,
  windowSeconds: 60,
};

interface Bucket {
  count: number;
  windowStartMs: number;
}

/**
 * BE CLEAR ABOUT WHAT THIS IS. A fixed window counted in a Map in one process.
 * It resets when the server restarts, and it counts nothing that happened on
 * another instance. On a single local process it genuinely does stop a script
 * hammering the form. It is not protection at scale and must not be mistaken
 * for it — which is why on Workers it is not used at all: there, every request
 * may land in a different isolate, so this would count almost nothing while
 * looking exactly as reassuring.
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #policy: WindowPolicy;

  constructor(policy: WindowPolicy) {
    this.#policy = policy;
  }

  async check(key: string): Promise<RateLimitDecision> {
    const now = Date.now();
    const windowMs = this.#policy.windowSeconds * 1000;
    const bucket = this.#buckets.get(key);

    if (bucket === undefined || now - bucket.windowStartMs >= windowMs) {
      this.#buckets.set(key, { count: 1, windowStartMs: now });
      this.#sweep(now, windowMs);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    if (bucket.count > this.#policy.limit) {
      const elapsed = now - bucket.windowStartMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drop expired buckets so a long-running process does not grow forever. */
  #sweep(now: number, windowMs: number): void {
    if (this.#buckets.size < 1000) return;
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.windowStartMs >= windowMs) this.#buckets.delete(key);
    }
  }
}

/**
 * The real one: Cloudflare counts, across every isolate, at the edge.
 *
 * The binding answers `{ success }` and nothing else — no count, no reset
 * time. So `retryAfterSeconds` is the window length, which is the honest upper
 * bound on the wait rather than a number we made up to look precise.
 */
export class BindingRateLimiter implements RateLimiter {
  readonly #binding: RateLimit;
  readonly #policy: WindowPolicy;
  readonly #name: string;

  constructor(binding: RateLimit, policy: WindowPolicy, name: string) {
    this.#binding = binding;
    this.#policy = policy;
    this.#name = name;
  }

  async check(key: string): Promise<RateLimitDecision> {
    let outcome: RateLimitOutcome;
    try {
      outcome = await this.#binding.limit({ key });
    } catch (error) {
      // FAIL OPEN, LOUDLY.
      //
      // A rate limiter exists to protect availability, so a limiter that is
      // itself unavailable has nothing to protect and every reason not to
      // start rejecting. The alternative is worse in this application than in
      // most: silently refusing adverse-event reports during an infrastructure
      // wobble loses reports that carry a 15-day regulatory clock, and the
      // reporter is simply told to come back later. The audit line is what
      // makes this visible rather than convenient.
      audit({
        actor: "system",
        action: "rate_limit_unavailable",
        target: this.#name,
        outcome: "success",
        detail: { error: error instanceof Error ? error.name : "unknown" },
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (outcome.success) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: this.#policy.windowSeconds };
  }
}

const localSubmitLimiter: RateLimiter = new InMemoryRateLimiter(SUBMIT_POLICY);
const localConverseLimiter: RateLimiter = new InMemoryRateLimiter(
  CONVERSE_POLICY,
);

/**
 * The lines Cluster C changed to the real binding.
 *
 * Async now, because the binding is only reachable asynchronously under the
 * adapter. Selection is on the BINDING's presence, not on the runtime: a
 * developer running `next dev` with the adapter's local proxy gets the real
 * limiter, which is the whole point of that proxy existing.
 */
export async function getSubmitRateLimiter(): Promise<RateLimiter> {
  const env = await getCloudflareEnv();
  const binding = env?.SUBMIT_RATE_LIMIT;
  if (binding === undefined) return localSubmitLimiter;
  return new BindingRateLimiter(
    binding,
    SUBMIT_BINDING_POLICY,
    "SUBMIT_RATE_LIMIT",
  );
}

export async function getConverseRateLimiter(): Promise<RateLimiter> {
  const env = await getCloudflareEnv();
  const binding = env?.CONVERSE_RATE_LIMIT;
  if (binding === undefined) return localConverseLimiter;
  return new BindingRateLimiter(
    binding,
    CONVERSE_BINDING_POLICY,
    "CONVERSE_RATE_LIMIT",
  );
}

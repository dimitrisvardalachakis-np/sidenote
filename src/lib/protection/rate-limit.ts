import "server-only";

/**
 * Rate limiting for the endpoints anyone can reach.
 *
 * CLAUDE.md puts a Turnstile plus a rate-limit binding in front of the public
 * report form. Neither exists without Cloudflare, and until now neither
 * existed at all: an anonymous endpoint that writes to storage, with nothing
 * in front of it. This is the local stand-in and the seam the real binding
 * drops into.
 *
 * BE CLEAR ABOUT WHAT THIS IS. A fixed window counted in a Map in one process.
 * It resets when the server restarts, and it counts nothing that happened on
 * another instance. On a single local process it genuinely does stop a script
 * hammering the form, and it makes the shape of the check real so that Cluster
 * C swaps the implementation rather than inventing the call sites. It is not
 * protection at scale and must not be mistaken for it.
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
 * Submitting a safety report is a deliberate act that takes minutes, so the
 * ceiling can be low without ever troubling a real person. Reading is cheaper
 * and gets a looser one.
 */
export const SUBMIT_POLICY: WindowPolicy = { limit: 5, windowSeconds: 600 };
export const CONVERSE_POLICY: WindowPolicy = { limit: 60, windowSeconds: 600 };

interface Bucket {
  count: number;
  windowStartMs: number;
}

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

const submitLimiter: RateLimiter = new InMemoryRateLimiter(SUBMIT_POLICY);
const converseLimiter: RateLimiter = new InMemoryRateLimiter(CONVERSE_POLICY);

/** The lines Cluster C changes to the real binding. */
export function getSubmitRateLimiter(): RateLimiter {
  return submitLimiter;
}
export function getConverseRateLimiter(): RateLimiter {
  return converseLimiter;
}

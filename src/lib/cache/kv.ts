import "server-only";
import { z } from "zod";
import { getCloudflareEnv } from "@/lib/platform/env";

/**
 * KV — and the reason there is no `put`.
 *
 * CLAUDE.md gives KV exactly one job: "Triage queue cache, feature flags,
 * cached label lookups", and one constraint, in brackets, that is easy to read
 * past — "(rebuildable only)".
 *
 * That constraint is the whole design of this file. KV is eventually
 * consistent: a write is not guaranteed to be visible to the next read, from
 * anywhere, for up to a minute. Anything whose only copy lives here can
 * therefore be *absent when asked for*, and in this application the things
 * that could plausibly end up here are cases and assessments — a queue that
 * loses a report is the failure mode the whole product exists to prevent.
 *
 * So the API is read-through only. `cached()` takes the function that rebuilds
 * the value, and there is no way to write a key without supplying it. You
 * cannot put something in this cache that the cache is the only copy of,
 * because the type system will ask you where it comes from.
 *
 * Everything read back is parsed through a zod schema, for the same reason
 * fetchJson and the D1 mappers do it: a cached value was serialised by an
 * older deploy as often as not.
 */

export interface KvCache {
  readonly available: boolean;
  cached<S extends z.ZodType>(
    key: string,
    schema: S,
    ttlSeconds: number,
    rebuild: () => Promise<z.output<S>>,
  ): Promise<z.output<S>>;
  drop(key: string): Promise<void>;
}

/**
 * Cloudflare's floor. Writing with a shorter TTL is an error rather than a
 * rounding, so it is clamped here where the number is visible.
 */
const MIN_TTL_SECONDS = 60;

class KvNamespaceCache implements KvCache {
  readonly available = true;
  readonly #kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.#kv = kv;
  }

  async cached<S extends z.ZodType>(
    key: string,
    schema: S,
    ttlSeconds: number,
    rebuild: () => Promise<z.output<S>>,
  ): Promise<z.output<S>> {
    const hit = await this.#kv.get(key, "json").catch(() => null);
    if (hit !== null) {
      const parsed = schema.safeParse(hit);
      // A miss and a stale-shaped hit take the same path: rebuild. Deleting
      // the bad key first would be tidier and is not worth a second round trip
      // — the TTL will do it, and every reader in the meantime rebuilds
      // correctly rather than rendering a shape the UI no longer expects.
      if (parsed.success) return parsed.data;
    }

    const fresh = await rebuild();

    // Deliberately not awaited into the caller's critical path? No — awaited.
    // A background write here would be a floating promise on Workers, which is
    // cancelled when the response is sent, so the cache would appear to work
    // locally and never populate in production.
    await this.#kv
      .put(key, JSON.stringify(fresh), {
        expirationTtl: Math.max(ttlSeconds, MIN_TTL_SECONDS),
      })
      .catch(() => {
        // A cache that cannot write is a slow cache, not a broken app.
      });

    return fresh;
  }

  async drop(key: string): Promise<void> {
    await this.#kv.delete(key).catch(() => {});
  }
}

/**
 * No KV bound: every read is a rebuild.
 *
 * Correct rather than degraded — the value returned is always the freshest one
 * there is. It is only slower, and saying that plainly is better than a
 * process-local Map that would make `next dev` behave unlike production in the
 * one dimension a cache is supposed to be invisible in.
 */
class UncachedCache implements KvCache {
  readonly available = false;

  async cached<S extends z.ZodType>(
    _key: string,
    _schema: S,
    _ttlSeconds: number,
    rebuild: () => Promise<z.output<S>>,
  ): Promise<z.output<S>> {
    return rebuild();
  }

  async drop(): Promise<void> {}
}

const uncached = new UncachedCache();

export async function getCache(): Promise<KvCache> {
  const env = await getCloudflareEnv();
  const kv = env?.CACHE;
  return kv === undefined ? uncached : new KvNamespaceCache(kv);
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const FlagValue = z.object({ enabled: z.boolean() });

/**
 * A flag, with the default applied when KV has nothing to say.
 *
 * `defaultValue` is required. An optional one would default to `false`, and a
 * flag that silently defaults off is how a feature gets shipped, tested, and
 * then quietly disabled in production by an unset key.
 */
export async function featureFlag(
  name: string,
  defaultValue: boolean,
): Promise<boolean> {
  const cache = await getCache();
  if (!cache.available) return defaultValue;

  const value = await cache.cached(
    `flag:${name}`,
    FlagValue,
    MIN_TTL_SECONDS,
    async () => ({ enabled: defaultValue }),
  );
  return value.enabled;
}

/** Cache keys, in one place so a typo is a compile error rather than a miss. */
export const CACHE_KEY = {
  /**
   * The reviewer queue's ENTRIES — records and assessments, never the rendered
   * rows. Dropped on every case and every assessment write.
   *
   * Scoped by day, because `buildSeedCases` recomputes every fixture's dates
   * from `today` so that the expedited clocks stay honest as the days pass. A
   * single undated key would serve yesterday's day-count across midnight for
   * as long as the TTL, on the one number this application exists to get
   * right. Yesterday's key is left to expire rather than swept: it is at most
   * one stale entry and it costs a minute.
   */
  triageQueue: (today: string) => `queue:triage:${today}:v2`,
  /** An openFDA label lookup, keyed by substance. */
  label: (substance: string) => `label:${substance.toLowerCase()}:v1`,
} as const;

/**
 * How long the queue may lag.
 *
 * Short, and paired with an explicit drop on every write that changes it. A
 * stale queue is tolerable for a minute — the cases in it were already
 * waiting. A queue that is MISSING a case somebody just filed is not tolerable
 * at any duration, which is why the write paths invalidate rather than waiting
 * this out.
 *
 * TWO write paths, not one. The case store's drop existed from the start; the
 * assessment store's did not, and without it a reviewer who recorded a ruling
 * and went back to the queue would have seen the case still unruled, with its
 * clock still running, for up to a minute. `loadQueue` returns assessments as
 * well as cases, so anything that writes one has to say so.
 */
export const TRIAGE_QUEUE_TTL_SECONDS = 60;

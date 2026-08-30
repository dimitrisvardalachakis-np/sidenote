import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CACHE_KEY, featureFlag, getCache } from "./kv";

/**
 * KV, with no KV bound.
 *
 * That is the honest thing to test here: without a real namespace there is no
 * eventual consistency to exercise, so what is worth pinning down is the
 * DEGRADED behaviour — which, for a read-through cache, should be
 * indistinguishable from the real thing except in speed.
 *
 * The API shape is the other half. `cached()` takes the rebuild function as a
 * required argument, which is how "rebuildable only" stops being a note in
 * CLAUDE.md and becomes something the compiler checks: there is no `put`, so
 * there is no way to make this cache the only copy of anything.
 */

const Value = z.object({ n: z.number() });

describe("with no namespace bound", () => {
  it("reports that it is not caching", async () => {
    const cache = await getCache();
    expect(cache.available).toBe(false);
  });

  it("still returns the right answer, by rebuilding every time", async () => {
    const cache = await getCache();
    const rebuild = vi.fn(async () => ({ n: 42 }));

    expect(await cache.cached("k", Value, 60, rebuild)).toEqual({ n: 42 });
    expect(await cache.cached("k", Value, 60, rebuild)).toEqual({ n: 42 });

    // Slower, never wrong. A process-local Map here would make `next dev`
    // behave unlike production in the one dimension a cache should be
    // invisible in.
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("returns the freshest value, never a stale one", async () => {
    const cache = await getCache();
    let n = 0;
    const rebuild = async () => ({ n: ++n });

    expect(await cache.cached("k", Value, 60, rebuild)).toEqual({ n: 1 });
    expect(await cache.cached("k", Value, 60, rebuild)).toEqual({ n: 2 });
  });

  it("drops without complaining", async () => {
    const cache = await getCache();
    await expect(cache.drop("nothing-here")).resolves.toBeUndefined();
  });
});

describe("featureFlag", () => {
  it("returns the default when there is nowhere to look it up", async () => {
    // Required rather than optional. An optional default would be `false`, and
    // a flag that silently defaults off is how a feature ships, gets tested,
    // and is then quietly disabled in production by an unset key.
    expect(await featureFlag("anything", true)).toBe(true);
    expect(await featureFlag("anything", false)).toBe(false);
  });
});

describe("cache keys", () => {
  it("are built in one place, so a typo is a compile error not a miss", () => {
    expect(CACHE_KEY.triageQueue).toBe("queue:triage:v1");
    // Case-folded: openFDA lookups are keyed by substance, and "Covaxil" and
    // "covaxil" are the same drug asked about twice.
    expect(CACHE_KEY.label("Covaxil")).toBe(CACHE_KEY.label("covaxil"));
  });

  it("carry a version, so a shape change cannot read an old value", () => {
    // The alternative is a deploy that reads yesterday's shape out of a key
    // that outlived it — which the schema check would reject, correctly, but
    // only after everyone's first request rebuilt.
    expect(CACHE_KEY.triageQueue).toMatch(/:v\d+$/);
    expect(CACHE_KEY.label("x")).toMatch(/:v\d+$/);
  });
});

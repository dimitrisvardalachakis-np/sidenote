import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The three-member type, and the two questions people ask it.
 *
 * `isStorageDurable()` and `hasLocalDisk()` agree on two of the three backings
 * and disagree on the third, and for a while six callers asked the durability
 * question when they meant the disk one. On a deployed Worker with D1 bound
 * that sent them into `nodeFs()`, which throws by design — so every reviewer
 * route 500'd. These tests exist to pin the disagreement, because it is
 * invisible in `next dev` and in this suite's default environment, which are
 * the only two places anyone looks.
 */
const env = vi.hoisted(() => ({
  value: null as { DB?: unknown } | null,
}));

vi.mock("@/lib/platform/env", () => ({
  getCloudflareEnv: async () => env.value,
}));

const { hasLocalDisk, isStorageDurable, storageBacking } = await import(
  "./backing"
);

/** `isWorkersRuntime()` reads this at call time, not at module load. */
function onWorkers(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  env.value = null;
});

describe("what is underneath the stores", () => {
  it("calls a Worker with D1 bound durable, and says it has no disk", async () => {
    // THE CASE THAT WAS WRONG. Both answers below are correct and they differ,
    // which is the entire point of having two functions.
    onWorkers();
    env.value = { DB: {} };

    expect(await storageBacking()).toBe("cloudflare");
    expect(await isStorageDurable()).toBe(true);
    expect(await hasLocalDisk()).toBe(false);
  });

  it("calls a laptop with no bindings durable, and says it has a disk", async () => {
    expect(await storageBacking()).toBe("local-disk");
    expect(await isStorageDurable()).toBe(true);
    expect(await hasLocalDisk()).toBe(true);
  });

  it("calls a Worker with nothing bound neither", async () => {
    onWorkers();

    expect(await storageBacking()).toBe("ephemeral");
    expect(await isStorageDurable()).toBe(false);
    expect(await hasLocalDisk()).toBe(false);
  });
});

/**
 * The accessor above is only worth having if the callers use it, so one caller
 * is exercised for real.
 *
 * `readAuditTrail` is the one to pick now. It has no D1 branch and is unlikely
 * to grow one soon — Logpush is where a deployed trail belongs — and the case
 * screen AWAITS it, so under the old check it threw out of `nodeFs()` and made
 * the whole page a 500 rather than a page with an empty history panel.
 *
 * This used to exercise `getAssessmentStore()`, which was then the sharpest of
 * the six. It has a D1 branch now, so on a Worker with D1 bound it no longer
 * degrades at all — which is the point of that change and the reason this test
 * had to move rather than be deleted.
 */
describe("a reader that has no D1 branch, on a Worker with D1 bound", () => {
  it("degrades to empty instead of reaching for node:fs", async () => {
    onWorkers();
    env.value = { DB: {} };

    const { readAuditTrail } = await import("./audit-store");

    // The throw was here: `nodeFs()` rejects before this ever returned.
    await expect(readAuditTrail("SN-2026-000101")).resolves.toEqual([]);
  });
});

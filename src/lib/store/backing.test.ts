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
 * is exercised for real. `getAssessmentStore()` is the sharpest of the six:
 * `loadQueue` calls it once per entry, so it is reached before anything else
 * on every reviewer route. Under the old check it selected the disk store on a
 * Worker with D1 bound and threw out of `nodeFs()` on the first read.
 */
describe("a store that has no D1 branch, on a Worker with D1 bound", () => {
  it("degrades to memory instead of reaching for node:fs", async () => {
    onWorkers();
    env.value = { DB: {} };

    const { getAssessmentStore } = await import("./assessment-store");
    const store = await getAssessmentStore();

    // The throw was here: `nodeFs()` rejects before this ever returned.
    await expect(
      store.get("00000002-0000-4000-8000-000000000101"),
    ).resolves.toBeNull();
  });
});

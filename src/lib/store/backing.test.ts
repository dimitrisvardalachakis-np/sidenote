import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkersRuntime } from "@/lib/platform/runtime";
import {
  dataPath,
  ephemeralSingleton,
  isStorageDurable,
  nodeFs,
  nodePath,
  storageBacking,
} from "./backing";

/**
 * The runtime split that Cluster C turns on.
 *
 * These tests exist because the failure they guard against is invisible: the
 * Worker BUILDS with node:fs in it, boots fine, serves pages, and only falls
 * over the first time somebody writes something. Nothing in the toolchain
 * catches that, so it is caught here.
 *
 * workerd identifies itself through navigator.userAgent, which is what the
 * predicate reads, so a test can stand the code on either runtime by stubbing
 * that one value. Node's own navigator.userAgent is "Node.js/<version>".
 */

function pretendToBeWorkers(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isWorkersRuntime", () => {
  it("is false under vitest, which is Node", () => {
    expect(isWorkersRuntime()).toBe(false);
  });

  it("is true when workerd says so", () => {
    pretendToBeWorkers();
    expect(isWorkersRuntime()).toBe(true);
  });

  it("is not fooled by a browser or by a lookalike agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Cloudflare-Workers" });
    // Substring matching here would let any client claim to be the runtime.
    expect(isWorkersRuntime()).toBe(false);
  });

  it("is read at call time, not captured at import", () => {
    expect(isWorkersRuntime()).toBe(false);
    pretendToBeWorkers();
    expect(isWorkersRuntime()).toBe(true);
    vi.unstubAllGlobals();
    expect(isWorkersRuntime()).toBe(false);
  });
});

describe("storageBacking", () => {
  it("is local-disk on Node and durable", async () => {
    expect(await storageBacking()).toBe("local-disk");
    expect(await isStorageDurable()).toBe(true);
  });

  it("is ephemeral on Workers and says it is not durable", async () => {
    pretendToBeWorkers();
    expect(await storageBacking()).toBe("ephemeral");
    // The banner reads this. If it ever returns true on Workers, the app tells
    // a member of the public their report is filed when it may not be.
    expect(await isStorageDurable()).toBe(false);
  });
});

describe("the node:fs door", () => {
  it("opens on Node", async () => {
    const fs = await nodeFs();
    expect(typeof fs.readFile).toBe("function");
    const path = await nodePath();
    expect(typeof path.join).toBe("function");
    expect(await dataPath("cases")).toMatch(/\.data[/\\]cases$/);
  });

  it("refuses on Workers rather than failing later and elsewhere", async () => {
    pretendToBeWorkers();
    // nodejs_compat resolves node:fs happily and the write fails at the call
    // site with a message about a path that never existed. Throwing at the
    // door names the actual problem.
    await expect(nodeFs()).rejects.toThrow(/not available on Workers/);
    await expect(nodePath()).rejects.toThrow(/not meaningful on Workers/);
    await expect(dataPath("cases")).rejects.toThrow(/Workers/);
  });
});

describe("ephemeralSingleton", () => {
  function reset(): void {
    delete (globalThis as unknown as { __sidenoteEphemeralStores?: unknown })
      .__sidenoteEphemeralStores;
  }

  it("hands the same instance to every caller of a key", () => {
    reset();
    let built = 0;
    const make = () => {
      built += 1;
      return { id: built };
    };

    // This is the whole reason the registry exists. Next bundles a route
    // handler and a page separately, so `store.ts` is evaluated twice in one
    // isolate; with a module-level const those two get separate Maps, and a
    // report filed through the API never appears in the queue. Observed
    // exactly that on workerd before this was added.
    const first = ephemeralSingleton("k", make);
    const second = ephemeralSingleton("k", make);

    expect(second).toBe(first);
    expect(built).toBe(1);
  });

  it("keeps different keys apart", () => {
    reset();
    const a = ephemeralSingleton("a", () => ({ name: "a" }));
    const b = ephemeralSingleton("b", () => ({ name: "b" }));
    expect(a).not.toBe(b);
    expect(ephemeralSingleton("a", () => ({ name: "other" }))).toBe(a);
  });
});

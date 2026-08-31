import "server-only";
import { audit } from "@/lib/audit";
import { getCloudflareEnv } from "@/lib/platform/env";
import { isWorkersRuntime } from "@/lib/platform/runtime";

/**
 * What is underneath the three stores on this runtime — and the lazy door to
 * Node's filesystem that keeps `node:fs` out of the Worker bundle.
 *
 * THIS IS THE CLUSTER C PROBLEM IN ONE FILE.
 *
 * CaseStore, DocumentLibrary and DocumentStore were all written against a real
 * filesystem: `.data/cases`, `.data/library`, `.data/objects`. Workers has no
 * filesystem. Not a read-only one, not a slow one — there is no disk, and
 * `process.cwd()` is a fiction the polyfill maintains to keep imports from
 * exploding.
 *
 * The dangerous part is that it BUILDS. `nodejs_compat` resolves
 * `node:fs/promises` happily, the bundle is produced, the Worker boots, and
 * the failure arrives later and elsewhere — the first time a reviewer uploads
 * a document, or a member of the public submits a report. So the check has to
 * be explicit and it has to happen before the call, not after it throws.
 *
 * WHAT CLUSTER D CHANGED.
 *
 * D1 holds the rows and R2 holds the bytes, so when those bindings are present
 * there is nothing ephemeral about any of this. The memory fallback did not go
 * away, because the two runtimes that legitimately have no bindings still
 * exist — `next dev` without the adapter proxy, and a Worker deployed before
 * anyone ran `wrangler d1 create`. It simply stopped being the normal case.
 *
 * That distinction is the whole reason `storageBacking()` asks about BINDINGS
 * and not about the runtime. A Worker with D1 bound is durable; a Worker
 * without it is not; and "am I on Workers" answers neither question.
 *
 * The memory fallback is still not silent. Every ephemeral write emits an
 * audit line naming itself, `isStorageDurable()` is exported for the UI to
 * tell the user plainly, and the classes are called Ephemeral*, not Memory* or
 * Default* — the same reasoning as UnprotectedBotGate. A stub wearing the name
 * of the real thing is worse than no stub.
 */

export type StorageBacking =
  /** D1 and R2 are bound. The real thing, on Workers or in `next dev`. */
  | "cloudflare"
  /** A real disk, no bindings. `next dev` and `next build` on a laptop. */
  | "local-disk"
  /** Per-isolate memory. A Worker with nothing bound to it. */
  | "ephemeral";

/**
 * Async because the answer depends on what is BOUND, not on where the code is
 * running, and reaching the bindings is asynchronous under the adapter.
 *
 * Worth the ripple. The sync version could only ask "am I on Workers", which
 * gets both interesting cases wrong: `next dev` with the adapter proxy has
 * real bindings and would be told to use the disk, and a Worker deployed
 * before `wrangler d1 create` has none and would be told it was durable.
 */
export async function storageBacking(): Promise<StorageBacking> {
  const env = await getCloudflareEnv();
  if (env?.DB !== undefined) return "cloudflare";
  return isWorkersRuntime() ? "ephemeral" : "local-disk";
}

/**
 * Will a write made now still be there later?
 *
 * Exported for the UI. A banner that says "not a validated system" and stays
 * quiet about the fact that this deployment forgets is only telling half of
 * the truth it was put there to tell.
 *
 * Local disk counts as durable. It is not durable the way D1 is — it is one
 * laptop — but the claim being made to the user is "work you save will still
 * be here", and on a developer machine that is true.
 */
export async function isStorageDurable(): Promise<boolean> {
  return (await storageBacking()) !== "ephemeral";
}

/**
 * Is there a filesystem under this process?
 *
 * The question every `nodeFs()` caller actually has. Five of them used to ask
 * it as `storageBacking() !== "ephemeral"`, which reads as "is storage
 * durable" — a DIFFERENT question that happens to agree on two of the three
 * values and disagrees on the one that matters. A deployed Worker with D1
 * bound is `"cloudflare"`: durable, and with no disk whatsoever. So those five
 * took the disk branch on Workers and threw out of `nodeFs()` below, turning
 * the graceful degradation each of them was written to have into a 500 on
 * every reviewer route.
 *
 * Named for the question so the answer cannot drift from it again. The type
 * has three members; a boolean built from two of them has to say which two.
 */
export async function hasLocalDisk(): Promise<boolean> {
  return (await storageBacking()) === "local-disk";
}

/**
 * Emitted on every ephemeral WRITE, and not on reads.
 *
 * A write is where the false promise is made — a read of something that is not
 * there merely returns null, which the callers already handle. If these lines
 * appear in a deployed environment's logs, storage is not durable there, and
 * that is worth a page rather than a shrug.
 */
export function announceEphemeralWrite(store: string, target: string): void {
  audit({
    actor: "system",
    action: "ephemeral_write",
    target: `${store}:${target}`,
    outcome: "success",
    detail: { reason: "no_durable_storage_bound", cluster_d_replaces_this: true },
  });
}

/**
 * Where the ephemeral stores actually live.
 *
 * FOUND BY RUNNING IT, NOT BY READING IT. With the store held in an ordinary
 * module-level `const`, five reports POSTed to /api/report were accepted and
 * numbered SN-2026-500001 through 500005 — so that route's Map was working —
 * and /queue then rendered the twelve seeded fixtures and none of them.
 *
 * The cause is that Next bundles route handlers and pages separately, so
 * `case-store.ts` is instantiated more than once in the same isolate and each
 * copy gets its own Map. On the disk implementation this is invisible, because
 * every copy reads the same `.data` directory. Swap the disk for memory and it
 * becomes a report that vanishes between being filed and being reviewed —
 * which reads as "the ephemeral store loses data", the one conclusion that
 * would have been drawn from the banner rather than investigated.
 *
 * globalThis is per-isolate, which is exactly the lifetime these stores claim
 * to have. It does not make them durable and is not meant to: it makes them
 * consistent for as long as they exist, so the only thing that loses data is
 * the thing the banner already warns about. All of this is deleted when
 * Cluster D binds D1 and R2 and there is one real store again.
 */
interface EphemeralHost {
  __sidenoteEphemeralStores?: Map<string, unknown>;
}

export function ephemeralSingleton<T>(key: string, create: () => T): T {
  // The one cast in this file. globalThis has no index signature, and a
  // registry that holds three different store types cannot be typed as one of
  // them — `unknown` in, cast out, at a single choke point rather than at
  // three call sites.
  const host = globalThis as unknown as EphemeralHost;
  const registry = (host.__sidenoteEphemeralStores ??= new Map<string, unknown>());

  const existing = registry.get(key);
  if (existing !== undefined) return existing as T;

  const created = create();
  registry.set(key, created);
  return created;
}

/**
 * Node's filesystem, loaded on first use and never on Workers.
 *
 * Dynamic rather than a top-level `import` so that the Worker bundle does not
 * carry the polyfill and — more to the point — so that the only way to reach
 * `writeFile` is through a function whose name says where it runs. A static
 * import at the top of a store module is an invitation to call it from a code
 * path that has not checked the runtime.
 */
export async function nodeFs(): Promise<typeof import("node:fs/promises")> {
  if (isWorkersRuntime()) {
    throw new Error(
      "node:fs is not available on Workers — check storageBacking() first",
    );
  }
  return import("node:fs/promises");
}

export async function nodePath(): Promise<typeof import("node:path")> {
  if (isWorkersRuntime()) {
    throw new Error(
      "node:path is not meaningful on Workers — check storageBacking() first",
    );
  }
  return import("node:path");
}

/**
 * `<cwd>/.data/<...segments>`.
 *
 * Computed on call rather than at module load. The old module-level constants
 * ran `join(process.cwd(), …)` at import time, which on Workers is a call into
 * a polyfill during module evaluation — harmless today and exactly the kind of
 * thing that stops being harmless without warning.
 */
export async function dataPath(...segments: readonly string[]): Promise<string> {
  const { join } = await nodePath();
  return join(process.cwd(), ".data", ...segments);
}

import "server-only";
import { audit } from "@/lib/audit";
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
 * WHAT CLUSTER C DOES NOT DO HERE.
 *
 * The real answer is D1 for the rows and R2 for the bytes, and CLAUDE.md
 * assigns both to Cluster D. Implementing them here would mean this cluster
 * quietly building the storage layer the next one is supposed to build
 * deliberately, and doing it under time pressure at the end of a runtime port.
 *
 * So on Workers the stores fall back to memory — and memory in a Worker is
 * per-isolate and can vanish between two requests. That is a real hazard in
 * THIS application: a member of the public submits an adverse-event report,
 * receives a reference number, and the record evaporates. A reference number
 * is a promise of durability.
 *
 * Which is why the fallback is not silent. Every ephemeral write emits an
 * audit line naming itself, `isStorageDurable()` is exported for the UI to
 * tell the user plainly, and the classes are called Ephemeral*, not Memory* or
 * Default* — the same reasoning as UnprotectedBotGate. A stub wearing the name
 * of the real thing is worse than no stub.
 */

export type StorageBacking =
  /** A real disk. `next dev` and `next build` on a developer's machine. */
  | "local-disk"
  /** Per-isolate memory. Workers, until Cluster D brings D1 and R2. */
  | "ephemeral";

export function storageBacking(): StorageBacking {
  return isWorkersRuntime() ? "ephemeral" : "local-disk";
}

/**
 * Will a write made now still be there later?
 *
 * Exported for the UI. A banner that says "not a validated system" and stays
 * quiet about the fact that this deployment forgets is only telling half of
 * the truth it was put there to tell.
 */
export function isStorageDurable(): boolean {
  return storageBacking() === "local-disk";
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

import "server-only";
import { drizzle } from "drizzle-orm/d1";
import { getCloudflareEnv } from "@/lib/platform/env";
import * as schema from "./schema";

/**
 * The one door to D1.
 *
 * Same shape of decision as `getCloudflareEnv()` above it: returns null rather
 * than throwing when there is no database, because "no D1 bound" is a real and
 * expected state — `next dev` without the adapter, a vitest run, and every
 * build-time page-data collection. The stores branch on it, and the branch
 * they take is the local one, not a crash.
 *
 * Drizzle is constructed per call rather than cached in a module constant. It
 * is a thin wrapper over the binding — there is no connection to pool, and no
 * pool to keep warm — and a cached instance would capture the `env` of
 * whichever request happened to be first, which on Workers is a genuine
 * cross-request bug rather than a theoretical one.
 *
 * Two doors rather than one, and they are different questions. `getDb()` finds
 * the binding in the ambient request context; `dbFrom()` is handed one. The
 * split exists because a Durable Object HAS `this.env.DB` and cannot use
 * `getDb()` to reach it: `getCloudflareContext()` throws outside a fetch
 * handler, and the ambient env is only set for the queue and cron handlers, so
 * `getDb()` inside a DO returns null every time. Construction still happens in
 * exactly one place, which is the part that was worth protecting.
 */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Drizzle over a binding somebody already holds. */
export function dbFrom(binding: D1Database): Db {
  return drizzle(binding, { schema });
}

export async function getDb(): Promise<Db | null> {
  const env = await getCloudflareEnv();
  const binding = env?.DB;
  if (binding === undefined) return null;
  return dbFrom(binding);
}

export { schema };

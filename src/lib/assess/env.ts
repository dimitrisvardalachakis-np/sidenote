import "server-only";
import { getCloudflareEnv } from "@/lib/platform/env";
import type { AiBinding } from "./ai";

/**
 * The environment the AI layer reads, from wherever this happens to be running.
 *
 * On Workers the bindings live on a per-request `env` object, not on
 * `process.env`; under `next dev` and on Node hosts there is no such object
 * and `process.env` is all there is. Rather than make every call site know
 * which world it is in, this returns one merged record and lets
 * `resolveAiBinding` narrow it.
 *
 * WHY THIS DELEGATES RATHER THAN ASKING THE ADAPTER ITSELF.
 *
 * It used to import `@opennextjs/cloudflare` and call `getCloudflareContext()`
 * directly, which was right until there were handlers other than `fetch`.
 * OpenNext publishes its Cloudflare context by writing it onto `globalThis`
 * from the fetch entrypoint and nowhere else — so inside the queue consumer or
 * a cron sweep that call throws, this returned `process.env` alone, `env.AI`
 * was not there, and `resolveAiBinding` reported no model configured. The
 * pipeline would then run to completion, degrade honestly, and record that it
 * had found nothing. Every layer behaving exactly as designed, and the queue
 * assessing nothing.
 *
 * `getCloudflareEnv()` is the one door that knows about that: it tries the
 * adapter first, so a real request always uses its own context, and falls back
 * to the ambient env that `worker/index.ts` sets for the two handlers the
 * adapter does not reach. Asking it here rather than reimplementing it is what
 * keeps this file from drifting out of agreement with the platform layer.
 *
 * The Cloudflare context's absence is not an error: on Node there simply is no
 * adapter to ask, which is the ordinary case in development and in tests.
 */
export async function aiEnv(): Promise<Readonly<Record<string, unknown>>> {
  const base: Record<string, unknown> = { ...process.env };

  const bindings = await getCloudflareEnv();
  if (bindings !== null) Object.assign(base, bindings);

  return base;
}

/** Re-exported so call sites do not need two imports to describe one thing. */
export type { AiBinding };

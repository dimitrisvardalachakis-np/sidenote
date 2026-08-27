import "server-only";
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
 * The Cloudflare context is looked up lazily and its absence is not an error:
 * on Node there simply is no adapter to ask, which is the ordinary case today.
 */
export async function aiEnv(): Promise<Readonly<Record<string, unknown>>> {
  const base: Record<string, unknown> = { ...process.env };

  try {
    // Resolved at runtime so the dependency stays optional: the adapter is
    // only installed once the app is actually deployed to Workers, and a
    // static import would break every Node run until then.
    const specifier = "@opennextjs/cloudflare";
    const mod: unknown = await import(/* webpackIgnore: true */ specifier);
    const get = (mod as { getCloudflareContext?: unknown }).getCloudflareContext;
    if (typeof get === "function") {
      const ctx = (get as () => { env?: Record<string, unknown> })();
      if (ctx.env !== undefined) Object.assign(base, ctx.env);
    }
  } catch {
    // No adapter here. Expected on Node; `resolveAiBinding` falls through to
    // the HTTP client, or to an honest "no model configured".
  }

  return base;
}

/** Re-exported so call sites do not need two imports to describe one thing. */
export type { AiBinding };

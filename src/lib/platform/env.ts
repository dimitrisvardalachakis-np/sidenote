import "server-only";

/**
 * The only typed door to the Cloudflare environment.
 *
 * Same argument as fetch.ts, one layer down. `env` on a Worker is a bag of
 * whatever the deployment happened to bind, and reading it ad hoc at each call
 * site means every call site independently decides what to do when a binding
 * is missing — which is how a half-configured deployment ends up looking
 * healthy. So there is one accessor, it returns `null` rather than throwing
 * when there is no Cloudflare underneath, and every caller has to say in code
 * what it does without its binding.
 *
 * `server-only`, because `env` holds secrets and a client component importing
 * this should be a build error rather than a leak.
 */

declare global {
  /**
   * Augments the interface `wrangler types` generates into
   * worker-configuration.d.ts.
   *
   * These two are declared here rather than as `vars` in wrangler.jsonc for a
   * concrete reason: `wrangler types` gives a declared var a LITERAL type, so
   * `"TURNSTILE_SITE_KEY": ""` in the config types the binding as `""` and
   * every "is it configured?" check becomes a comparison the compiler has
   * already decided the answer to. Optional strings keep the runtime question
   * a runtime question.
   */
  interface CloudflareEnv {
    /**
     * Public by design — it is rendered into the Turnstile widget's markup and
     * anyone can read it out of the page. Absent means no widget is shown.
     */
    TURNSTILE_SITE_KEY?: string;
    /**
     * Secret. `wrangler secret put TURNSTILE_SECRET_KEY`, or .dev.vars
     * locally. Only ever sent to Cloudflare's siteverify endpoint, never to a
     * client. Absent means the bot gate is not configured, which
     * UnprotectedBotGate reports loudly rather than treating as protection.
     */
    TURNSTILE_SECRET_KEY?: string;
  }
}

/**
 * The Worker's bindings, or null when there is no Cloudflare underneath.
 *
 * Null is a real, expected answer, not an error: `next dev` without
 * initOpenNextCloudflareForDev(), `next build`'s page-data collection, and
 * every vitest run all legitimately have no platform. Callers branch on it.
 *
 * The adapter is imported dynamically so that merely importing this module —
 * which the schemas and the protection modules all do — does not drag the
 * adapter into a test's module graph or a build that has no use for it.
 */
export async function getCloudflareEnv(): Promise<CloudflareEnv | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context.env;
  } catch {
    // getCloudflareContext throws when the adapter is not initialised. That is
    // the "running on plain Node" case and it is not a failure, so it is not
    // logged: this is called on every guarded request and a line per request
    // would bury the audit log it sits next to.
    return null;
  }
}

/**
 * Read one string binding, treating empty string as absent.
 *
 * A var set to "" is what a half-filled dashboard field or a `.dev.vars` line
 * with nothing after the `=` produces, and it means "not configured" every
 * time. Collapsing it to null here stops each caller having to remember that
 * `if (secret)` and `if (secret !== undefined)` are different tests.
 */
export function readSetting(
  env: CloudflareEnv | null,
  key: "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY",
): string | null {
  const fromBinding = env?.[key];
  if (typeof fromBinding === "string" && fromBinding !== "") return fromBinding;

  // process.env is the `next dev` path: .dev.vars is not loaded without the
  // adapter, but a developer exporting the variable in their shell should
  // still get the real code path rather than the stub.
  const fromProcess = process.env[key];
  if (typeof fromProcess === "string" && fromProcess !== "") return fromProcess;

  return null;
}

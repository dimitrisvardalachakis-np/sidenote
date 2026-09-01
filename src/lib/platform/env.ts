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
    /**
     * The one deliberate way past the production refusal below, and it exists
     * because the refusal was right and shipped anyway.
     *
     * `guard.ts` refuses a browser submission in production when Turnstile was
     * never configured — correct, because that state is permanent rather than
     * a wobble. The consequence, discovered on the deployed app rather than
     * here: with no widget created yet, every intake chat turn and every
     * report answered "a configuration problem on our side", so the public
     * half of the demo was dead while the reviewer half looked fine.
     *
     * So: an opt-out that has to be SET, is never a default, and is recorded
     * on every request it lets through. The literal string "1" and nothing
     * else, so a truthy accident cannot switch the bot gate off. Delete the
     * secret the moment the widget exists.
     */
    SIDENOTE_UNPROTECTED_INTAKE?: string;
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
/**
 * The env for handlers that are not `fetch`.
 *
 * FOUND BY RUNNING IT. A report was submitted, the queue consumer ran —
 * `QUEUE sidenote-ingest 1/1 (3ms)` — and did nothing at all. Three
 * milliseconds, no audit line, no assessment.
 *
 * The cause: OpenNext publishes its Cloudflare context by writing it onto
 * `globalThis` from the FETCH entrypoint. A queue or cron handler never goes
 * through that path, so `getCloudflareContext()` throws, `getCloudflareEnv()`
 * returned null, D1 looked unbound, the case store fell back to memory, the
 * case was "not found", and the step returned successfully having skipped its
 * own work. Every layer behaved exactly as designed and the pipeline was inert.
 *
 * So the worker entry hands the env in explicitly for those handlers. Module
 * scope is safe for this: `env` is per-isolate, not per-request — the same
 * object is passed to every invocation — so there is no request whose bindings
 * could leak into another's.
 */
let ambientEnv: CloudflareEnv | null = null;

/** Called by worker/index.ts for the queue and scheduled handlers. */
export function setAmbientCloudflareEnv(env: CloudflareEnv): void {
  ambientEnv = env;
}

export async function getCloudflareEnv(): Promise<CloudflareEnv | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context.env;
  } catch {
    // getCloudflareContext throws when the adapter is not initialised: plain
    // Node, or a non-fetch handler. Not logged — this runs on every guarded
    // request and a line per request would bury the audit log it sits next to.
    //
    // The adapter is tried FIRST so that a real request always uses its own
    // context; the ambient env is the fallback, not the default.
    return ambientEnv;
  }
}

/**
 * The keys of CloudflareEnv whose value is a string.
 *
 * Computed rather than listed, so adding a new setting to the interface makes
 * it readable here automatically — and so passing `DB` or `CACHE` by mistake
 * is a compile error rather than a runtime `undefined`.
 */
type StringSettingKey = {
  [K in keyof CloudflareEnv]-?: NonNullable<CloudflareEnv[K]> extends string
    ? K
    : never;
}[keyof CloudflareEnv];

/**
 * Read one string setting, treating empty string as absent.
 *
 * A var set to "" is what a half-filled dashboard field or a `.dev.vars` line
 * with nothing after the `=` produces, and it means "not configured" every
 * time. Collapsing it to null here stops each caller having to remember that
 * `if (secret)` and `if (secret !== undefined)` are different tests.
 */
export function readSetting(
  env: CloudflareEnv | null,
  key: StringSettingKey,
): string | null {
  const fromBinding = env?.[key];
  if (typeof fromBinding === "string" && fromBinding !== "") return fromBinding;

  // process.env is the `next dev` path: .dev.vars is not loaded without the
  // adapter, but a developer exporting the variable in their shell should
  // still get the real code path rather than the stub.
  const fromProcess = process.env[key as string];
  if (typeof fromProcess === "string" && fromProcess !== "") return fromProcess;

  return null;
}

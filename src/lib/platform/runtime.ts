/**
 * Which runtime is this code actually executing in?
 *
 * There are three, and conflating any two of them is how Cluster C goes wrong:
 *
 *   node        `next dev` / `next build` on a developer's machine. Real
 *               filesystem, no Cloudflare bindings.
 *   node+proxy  `next dev` after initOpenNextCloudflareForDev(). Real
 *               filesystem AND real bindings, proxied out to a local workerd.
 *   workers     the deployed Worker, or `wrangler dev`. Real bindings, and NO
 *               filesystem at all.
 *
 * The middle one is the reason this file exists. "Are there bindings?" and "is
 * there a disk?" are different questions with different answers, and a single
 * `isProduction`-shaped flag answers both wrongly. So:
 *
 *   - Turnstile and the rate limiter ask whether their BINDING is present,
 *     because they should run for real in `next dev` the moment it is.
 *   - The stores ask this function, because in `next dev` the disk is still
 *     there and writing to it is still the right thing to do.
 *
 * No `server-only` marker here on purpose: this is a plain predicate about the
 * host and it holds no secret.
 *
 * There is deliberately no `isBrowserRuntime()` companion. pdf-client.ts asks
 * that question with a one-line `typeof window` check of its own and does not
 * need a helper, and an exported predicate with one caller is an abstraction
 * charging rent.
 */

/** What workerd reports. Cloudflare sets this; it is not a heuristic. */
const WORKERS_USER_AGENT = "Cloudflare-Workers";

/**
 * True only on workerd — the deployed Worker or `wrangler dev`.
 *
 * Read at call time rather than captured in a module constant. A module
 * constant is evaluated once per isolate, which is fine in production and
 * quietly wrong under a test that wants to exercise both branches.
 */
export function isWorkersRuntime(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === WORKERS_USER_AGENT
  );
}

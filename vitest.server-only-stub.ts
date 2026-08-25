/**
 * Stands in for the `server-only` package under vitest.
 *
 * `server-only`'s real entry point throws on import unless the resolver runs
 * with React's "react-server" condition, which vitest does not. Turning that
 * condition on globally would change how every other package resolves — react
 * included — to fix one marker import, so the marker is aliased to this
 * instead (see vitest.config.mts).
 *
 * This does NOT weaken the guarantee it exists for. The marker's job is to
 * fail the BUILD when a client component imports a server module, and
 * `npm run build` still does exactly that. A vitest run is not a client
 * component.
 */
export {};

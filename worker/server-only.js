/**
 * Stands in for the `server-only` marker inside the Worker bundle.
 *
 * The marker's real entry point throws unless the resolver runs with React's
 * "react-server" condition. Next's bundler sets that when it builds the app, so
 * everything inside .open-next resolves correctly. But `worker/index.ts` pulls
 * the queue consumer — and through it most of src/lib — into a bundle that
 * WRANGLER builds, with no such condition, and the throw took the whole Worker
 * down at startup:
 *
 *   Uncaught Error: This module cannot be imported from a Client Component
 *   module. It should only be used from a Server Component.
 *
 * Aliased to this in wrangler.jsonc. Nothing is weakened: the marker exists to
 * stop server code reaching a browser, `npm run build` still enforces exactly
 * that, and a Cloudflare Worker is the server.
 */

/**
 * Types for the generated Worker.
 *
 * `.open-next/worker.js` exists only after `opennextjs-cloudflare build`. That
 * makes it awkward to import from a typechecked file: with the directory
 * present TypeScript infers it and a `@ts-expect-error` is flagged as unused;
 * without it, the import fails. Suppressing one of those breaks the other, and
 * `npm run typecheck` has to pass on a fresh checkout — which is exactly the
 * state CI is always in.
 *
 * So the module is DECLARED instead, `.open-next` is excluded from the TS
 * program in tsconfig.json, and the shape below is asserted rather than
 * inferred. That is a real trade: if OpenNext changes what its worker exports,
 * this file will not notice, and the failure will be at runtime. It is bounded
 * by how little we use — a fetch handler and three Durable Object classes we
 * only pass through — and `npm run preview` exercises all of it on workerd.
 */
declare module "*/.open-next/worker.js" {
  const handler: {
    fetch(
      request: Request,
      env: CloudflareEnv,
      ctx: ExecutionContext,
    ): Promise<Response>;
  };
  export default handler;

  /** Next's revalidation queue, its tag cache, and its cache purger. */
  export const DOQueueHandler: unknown;
  export const DOShardedTagCache: unknown;
  export const BucketCachePurge: unknown;
}

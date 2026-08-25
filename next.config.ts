import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Default is 1MB, which a 40-page CCDS blows through immediately.
       *
       * This limit exists ONLY because Cluster A has no presigned uploads, so
       * the original file has to travel through a Server Action. CLAUDE.md's
       * target architecture sends the bytes browser-to-R2 directly and has
       * the Worker keep nothing but the object key — at which point the
       * action carries metadata and extracted text alone, and this line
       * should be deleted rather than raised again.
       */
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;

/**
 * Makes `next dev` see the Cloudflare bindings.
 *
 * Without this, `getCloudflareEnv()` returns null under `next dev` and the
 * protection modules fall back to their local stand-ins — which means a
 * developer with a real Turnstile secret in .dev.vars would still be
 * exercising UnprotectedBotGate, and would find that out in production.
 *
 * A no-op outside `next dev`: it is not awaited because the adapter documents
 * it as fire-and-forget, and a Next config that returns a promise is a
 * different thing entirely.
 */
void initOpenNextCloudflareForDev();

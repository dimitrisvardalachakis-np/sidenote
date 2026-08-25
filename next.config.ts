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
 * TWO GUARDS, BOTH LEARNED THE HARD WAY.
 *
 * `remoteBindings: false`. Cluster E added Vectorize and Workers AI, and
 * neither has local emulation — the proxy tries to open a REMOTE session for
 * them, and without a CLOUDFLARE_API_TOKEN that is a hard failure. Which means
 * that on the day those two bindings were added, `next build` stopped working
 * for anyone without a Cloudflare account. It is off here so the local
 * toolchain stays usable offline; the cost is that those two bindings are
 * absent in `next dev`, which the code already handles because it has to
 * handle them being absent in a fresh deployment too.
 *
 * Only during `next dev`. The adapter is documented as a no-op elsewhere, but
 * it is not: it initialises during `next build` as well, which is where the
 * remote-session failure above actually surfaced.
 */
if (process.env["NEXT_PHASE"] === "phase-development-server") {
  void initOpenNextCloudflareForDev({ remoteBindings: false });
}

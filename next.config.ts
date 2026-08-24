import type { NextConfig } from "next";

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

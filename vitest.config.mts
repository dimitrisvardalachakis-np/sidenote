import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the tsconfig "@/*" path alias so tests import exactly the way
    // application code does. If these two ever disagree, a test can pass
    // against a module the app never loads.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /**
       * `server-only` throws on import outside a React Server Component, which
       * is exactly what it is for — Next enforces the boundary at build time
       * through the react-server export condition. Vitest is neither, so the
       * module is stubbed here to let server modules be unit-tested directly.
       * This weakens nothing: the build-time guarantee is untouched.
       */
      "server-only": fileURLToPath(
        new URL("./src/lib/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    /**
     * node by default, on purpose: the domain layer is pure and must stay
     * that way, and a test that quietly needs a DOM to pass is a signal
     * something leaked in.
     *
     * Component tests opt in per file with a
     *   // @vitest-environment jsdom
     * docblock, so the exception is visible at the top of the file that
     * needs it rather than applied to everything.
     */
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

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
      // See vitest.server-only-stub.ts for why this is aliased rather than
      // resolved: the real module throws unless the "react-server" condition
      // is on, and turning that on globally would change how every other
      // package resolves.
      "server-only": fileURLToPath(
        new URL("./vitest.server-only-stub.ts", import.meta.url),
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

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path alias so tests import exactly the way
    // application code does. If these two ever disagree, a test can pass
    // against a module the app never loads.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The domain layer is pure and must stay that way: no DOM, no platform.
    // A test that needs jsdom to pass is a signal something leaked in.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

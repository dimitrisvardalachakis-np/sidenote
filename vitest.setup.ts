/**
 * Test setup.
 *
 * Two jobs: the DOM matchers component tests need, and `.env.local` for the
 * two opt-in scripts that need real credentials.
 *
 * The /vitest entrypoint registers jest-dom's matchers AND their types, so
 * toHaveFocus and toBeDisabled type-check as well as run. Extending `expect`
 * by hand works at runtime and leaves TypeScript not knowing about any of it.
 *
 * cleanup after each test is explicit because React Testing Library only
 * registers it automatically when vitest runs with globals enabled, and this
 * project does not. Without it every render stacks in the same document and
 * getByLabelText starts finding three of everything.
 */
import { readFileSync } from "node:fs";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);

/**
 * `.env.local`, but only for the two scripts that genuinely need credentials.
 *
 * `.env.local` is a NEXT feature. Nothing loads it under vitest, so
 * `npm run embed:seed` and `npm run embed:backfill` — both documented in
 * SETUP.md as needing real credentials — could not see the credentials
 * SETUP.md had just told you to put there. They failed with "CLOUDFLARE_
 * ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set" on a machine where both
 * were set, which sends you to check the one file that was already correct.
 *
 * GATED, AND THAT IS THE POINT. An ordinary `npm test` must not pick up
 * credentials: `degraded.test.ts` walks the no-model path end to end, and a
 * test suite that quietly acquired a real model would be testing something
 * other than what it claims — and would spend money doing it. Only the two
 * flags the scripts set themselves open this door.
 */
const NEEDS_CREDENTIALS =
  process.env["SIDENOTE_EMBED_SEED"] === "1" ||
  process.env["SIDENOTE_EMBED_BACKFILL"] === "1";

if (NEEDS_CREDENTIALS) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;

      const key = trimmed.slice(0, eq).trim();
      // The shell wins, the way Next resolves the same conflict, so
      // `SIDENOTE_AI_BASE_URL=… npm run embed:backfill` still points at the
      // stub — which is a switch `embed-seed.test.ts` refuses to run under
      // and therefore has to be able to see.
      if (process.env[key] !== undefined) continue;

      const raw = trimmed.slice(eq + 1).trim();
      const quoted =
        raw.length > 1 &&
        ((raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'")));
      process.env[key] = quoted ? raw.slice(1, -1) : raw;
    }
  } catch {
    // No `.env.local`. Both scripts already fail naming the exact variable
    // that is missing, which is a better error than anything here could give.
  }
}

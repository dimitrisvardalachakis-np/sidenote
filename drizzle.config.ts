import { defineConfig } from "drizzle-kit";

/**
 * Migration generation only.
 *
 * There is no `driver` and no credentials here on purpose: this config never
 * talks to a database. `drizzle-kit generate` diffs schema.ts against the
 * migrations already in ./drizzle and writes the next .sql file; applying it
 * is wrangler's job, because wrangler is what knows whether "the database"
 * means the local SQLite file under .wrangler or the real D1 instance.
 *
 * `out` matches `migrations_dir` in wrangler.jsonc. If those two ever
 * disagree, `drizzle-kit generate` writes migrations that
 * `wrangler d1 migrations apply` cannot see, and the failure looks like
 * "table not found" rather than like a misconfiguration.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  strict: true,
});

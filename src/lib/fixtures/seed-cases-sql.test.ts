/**
 * The fixture-case SQL generator, a test for the same reason `embed-seed` is.
 *
 * There is no `tsx` or `vite-node` here, and a plain `.mjs` cannot resolve the
 * `@/` alias or the TypeScript fixtures. Vitest resolves both exactly as the
 * app does, so the generator lives here, gated on an environment variable and
 * therefore a genuine no-op inside `npm run build`.
 *
 *   npm run seed:cases:sql
 *   npx wrangler d1 execute sidenote --remote --file=drizzle/seed-cases.sql
 *
 * WHY THIS EXISTS AT ALL. The twelve demo cases are built in code by
 * `buildSeedCases()` and were never rows in any database. That is fine until
 * something wants to point a foreign key at one: `assessments.case_id`
 * references `cases(id)`, so on a deployment where D1 is bound, storing an
 * assessment against a fixture fails the constraint and 500s the case screen.
 * Locally there is no D1 binding, the assessment store falls through to the
 * disk, and nothing has a foreign key to violate — which is why this only ever
 * appeared once the Worker was deployed.
 *
 * These rows are ANCHORS, not a second copy of the truth. `loadQueue` filters
 * them back out of the store listing and renders the fixture, because the
 * fixture recomputes its dates from `today` and these rows cannot. Read a
 * `received_at` here as "the day this file was generated", not as the case's
 * standing age — the screen never shows it.
 *
 * The upsert is deliberate: re-running this must be safe, and must not disturb
 * an assessment already hanging off one of these ids.
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { caseToRows } from "@/lib/db/mappers";
import { IsoDate } from "@/lib/schemas";
import { buildSeedCases } from "./seed";

const ENABLED = process.env["SIDENOTE_SEED_CASES_SQL"] === "1";

export const SEED_CASES_SQL_PATH = "drizzle/seed-cases.sql";

/** SQLite string literal. Doubling the quote is the whole of the escaping. */
function lit(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * An upsert that names every column twice.
 *
 * Verbose against a `REPLACE INTO`, and chosen over it: `REPLACE` deletes the
 * conflicting row first, and `assessments.case_id` cascades on delete, so
 * re-running the seed would silently destroy every assessment recorded against
 * a fixture. That is precisely the data this whole change exists to make
 * storable.
 */
function upsert(table: string, row: Record<string, string | number | boolean | null>): string {
  const columns = Object.keys(row);
  const values = columns.map((c) => lit(row[c] ?? null));
  const assignments = columns
    .filter((c) => c !== "id")
    .map((c) => `"${c}" = excluded."${c}"`);
  return (
    `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})\n` +
    `VALUES (${values.join(", ")})\n` +
    `ON CONFLICT("id") DO UPDATE SET ${assignments.join(", ")};`
  );
}

describe.runIf(ENABLED)("generating the fixture-case SQL", () => {
  it("writes an idempotent upsert for every seeded case", async () => {
    const today = IsoDate.parse(new Date().toISOString().slice(0, 10));
    const cases = buildSeedCases(today);
    expect(cases.length).toBeGreaterThan(0);

    const statements: string[] = [];
    for (const seeded of cases) {
      const { caseRow, drugRows, reactionRows } = caseToRows(seeded.record);

      // Column names are the DATABASE's, not Drizzle's camelCase field names —
      // this file is executed by wrangler, which never sees the schema module.
      statements.push(
        upsert("cases", {
          id: caseRow.id,
          reference: caseRow.reference,
          origin: caseRow.origin,
          received_at: caseRow.receivedAt,
          patient: caseRow.patient,
          reporter: caseRow.reporter,
          narrative: caseRow.narrative,
          status: caseRow.status,
          assigned_to: caseRow.assignedTo,
          created_at: caseRow.createdAt,
          updated_at: caseRow.updatedAt,
        }),
      );

      for (const drug of drugRows) {
        statements.push(
          upsert("drugs", {
            id: drug.id,
            case_id: drug.caseId,
            ordinal: drug.ordinal,
            reported_name: drug.reportedName,
            active_substance: drug.activeSubstance,
            role: drug.role,
            marketing_status: drug.marketingStatus,
            dose: drug.dose,
            route: drug.route,
            indication: drug.indication,
            therapy_start: drug.therapyStart,
            therapy_end: drug.therapyEnd,
            dechallenge: drug.dechallenge,
            rechallenge: drug.rechallenge,
          }),
        );
      }

      for (const reaction of reactionRows) {
        statements.push(
          upsert("reactions", {
            id: reaction.id,
            case_id: reaction.caseId,
            ordinal: reaction.ordinal,
            verbatim_term: reaction.verbatimTerm,
            meddra_preferred_term: reaction.meddraPreferredTerm,
            onset: reaction.onset,
            outcome: reaction.outcome,
            seriousness: reaction.seriousness,
            serious: reaction.serious,
          }),
        );
      }
    }

    // A real assertion, not a formality: every case must carry its children,
    // because a case row with no reactions fails `Case.parse` on the way back
    // out and would be skipped by the store's own error handling — leaving the
    // foreign key anchored to a row nothing can read.
    expect(statements.length).toBeGreaterThan(cases.length * 2);
    for (const seeded of cases) {
      expect(seeded.record.reactions.length).toBeGreaterThan(0);
      expect(seeded.record.drugs.length).toBeGreaterThan(0);
    }

    const header =
      `-- Generated by \`npm run seed:cases:sql\` on ${today}.\n` +
      `-- Anchors for assessments.case_id. The queue renders the code fixture,\n` +
      `-- not these rows — see src/lib/queue/entries.ts.\n` +
      `-- Do not hand-edit; regenerate.\n\n`;

    await writeFile(
      SEED_CASES_SQL_PATH,
      header + statements.join("\n\n") + "\n",
      "utf8",
    );
  });
});

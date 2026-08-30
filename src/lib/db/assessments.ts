import "server-only";
import { eq, inArray } from "drizzle-orm";
import { Assessment } from "@/lib/schemas";
import { assessmentToRow } from "./mappers";
import { getDb, schema } from "./client";

/**
 * Assessments in D1.
 *
 * Small enough not to need a store interface with two implementations: without
 * D1 there is nothing to read and nothing to write, and the callers all handle
 * "no assessment" already because a just-submitted case genuinely has none.
 * That nullability is load-bearing — the queue distinguishes "assessed and
 * found nothing" from "nobody has looked", and inventing an empty assessment
 * here would render as the first when the truth is the second.
 */

export async function saveAssessment(assessment: Assessment): Promise<void> {
  const db = await getDb();
  if (db === null) return;

  const row = assessmentToRow(assessment);
  await db
    .insert(schema.assessments)
    .values(row)
    .onConflictDoUpdate({ target: schema.assessments.id, set: row });
}

function parse(row: typeof schema.assessments.$inferSelect): Assessment | null {
  try {
    return Assessment.parse({
      id: row.id,
      caseId: row.caseId,
      reactionId: row.reactionId,
      drugId: row.drugId,
      listedness: JSON.parse(row.listedness) as unknown,
      expectedness: JSON.parse(row.expectedness) as unknown,
      ruling: row.ruling === null ? null : (JSON.parse(row.ruling) as unknown),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch {
    // An assessment that no longer parses is dropped rather than rendered.
    // Showing half a finding would put an uncited claim in front of a reviewer,
    // which non-negotiable #3 forbids outright.
    return null;
  }
}

/** The assessments for a set of cases, keyed by case id. One query. */
export async function assessmentsForCases(
  caseIds: readonly string[],
): Promise<ReadonlyMap<string, Assessment>> {
  const found = new Map<string, Assessment>();
  if (caseIds.length === 0) return found;

  const db = await getDb();
  if (db === null) return found;

  const rows = await db
    .select()
    .from(schema.assessments)
    .where(inArray(schema.assessments.caseId, [...caseIds]));

  for (const row of rows) {
    const assessment = parse(row);
    // Last write wins when a case somehow has two. The schema says one
    // assessment per reaction-drug pair, and the screens render one; picking
    // the newest is the least surprising of the wrong answers.
    if (assessment !== null) {
      const existing = found.get(row.caseId);
      if (existing === undefined || existing.updatedAt < assessment.updatedAt) {
        found.set(row.caseId, assessment);
      }
    }
  }
  return found;
}

export async function assessmentForCase(
  caseId: string,
): Promise<Assessment | null> {
  const db = await getDb();
  if (db === null) return null;

  const rows = await db
    .select()
    .from(schema.assessments)
    .where(eq(schema.assessments.caseId, caseId));

  let newest: Assessment | null = null;
  for (const row of rows) {
    const assessment = parse(row);
    if (assessment === null) continue;
    if (newest === null || newest.updatedAt < assessment.updatedAt) {
      newest = assessment;
    }
  }
  return newest;
}

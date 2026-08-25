import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { audit, type AuditLine } from "./audit";
import { getDb, schema } from "./db/client";

/**
 * The audit trail, in D1 — and an honest account of why.
 *
 * audit.ts said "In Cluster F this gains a real sink". The console line WAS
 * already a real sink and stays the primary one: `observability` is enabled in
 * wrangler.jsonc, so Workers Logs retains those lines and Logpush ships them.
 * Replacing console.log with a database write would have traded a sink that
 * survives the Worker crashing for one that does not.
 *
 * So this is not a replacement. It is a mirror, and it exists for a different
 * reason than durability: THE APPLICATION NEEDS TO READ ITS OWN AUDIT TRAIL.
 * The nightly deadline sweep has to know whether it already reported a case as
 * overdue, or it reports every overdue case again every night until somebody
 * stops reading the alerts. You cannot ask Logpush that question from inside a
 * cron handler; you can ask D1.
 *
 * Which is why this is a narrow API rather than a global swap: the lines that
 * get mirrored are the ones something later needs to query.
 */

/** Write the line to both sinks. The console one is never skipped. */
export async function recordAudit(line: AuditLine): Promise<void> {
  // Console first and unconditionally. If the database write throws, the line
  // still exists somewhere — the opposite order would lose the record of
  // whatever we were in the middle of doing.
  audit(line);

  const db = await getDb();
  if (db === null) return;

  try {
    await db.insert(schema.auditLog).values({
      actor: line.actor,
      action: line.action,
      target: line.target,
      outcome: line.outcome,
      detail: line.detail === undefined ? null : JSON.stringify(line.detail),
      at: new Date().toISOString(),
    });
  } catch {
    // A failed audit write must not fail the thing being audited. The console
    // line has already gone out, so the record is not lost — only the ability
    // to query it, which degrades the sweep's memory and nothing else.
  }
}

/**
 * Has this exact thing already been recorded for this target since `since`?
 *
 * The sweep's memory. Without it, "this case is overdue" is emitted every
 * night for every overdue case, and an alert that fires every night for weeks
 * is an alert nobody reads — which is worse than no alert, because it looks
 * like coverage.
 */
export async function alreadyRecorded(
  action: string,
  target: string,
  since: string,
): Promise<boolean> {
  const db = await getDb();
  // No database means no memory. Erring towards "not recorded" means the line
  // is emitted again, which is noisy; the opposite would silently suppress a
  // missed-deadline alert. Noisy is the right failure here.
  if (db === null) return false;

  try {
    const [row] = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, action),
          eq(schema.auditLog.target, target),
          gte(schema.auditLog.at, since),
        ),
      )
      .limit(1);
    return row !== undefined;
  } catch {
    return false;
  }
}

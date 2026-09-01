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
 *
 * WHAT "SOMETHING LATER NEEDS TO QUERY" TURNED OUT TO MEAN.
 *
 * For a while that was the sweeps and nothing else, and the consequence showed
 * up on the deployed app: `audit_log` held exactly two rows, both from the
 * previous night's crons, after a session that signed in, claimed a case,
 * uploaded a document and recorded a ruling. Every one of those emitted a
 * console line — `wrangler tail | grep AUDIT` returns them, which satisfies
 * non-negotiable #9 to the letter — and the durable table the schema defines
 * had no record of any human action at all. A table that exists and is empty
 * is worse than no table, because it looks like coverage.
 *
 * So every MUTATION is mirrored now: claim, release, rule, assess, upload,
 * submit. The rule for what is not:
 *
 *   NOT `CaseCoordinator`. Its lines are emitted inside a Durable Object's
 *   single-threaded turn, and that turn is the serialisation that makes
 *   claiming correct — two reviewers racing one case are queued behind it.
 *   Adding a D1 round trip per line lengthens exactly that critical section,
 *   to duplicate a line the Server Action mirrors one frame later anyway.
 *
 *   NOT the generation and retrieval lines. They are observations rather than
 *   changes, they are the highest-volume lines in the system, and nothing
 *   queries them — an operator reading them is reading Workers Logs, where
 *   they already are.
 *
 * The console line remains the record. This is the queryable mirror of it.
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

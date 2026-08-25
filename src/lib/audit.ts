/**
 * CLAUDE.md non-negotiable #6: every mutation emits a structured audit line —
 * a single-line JSON with actor, action, target, timestamp, outcome, prefixed
 * [AUDIT].
 *
 * Single-line is not a stylistic preference. Log shippers split on newlines,
 * so a pretty-printed record arrives as eight unparseable fragments. The
 * prefix exists so the line can be grepped out of everything else a Worker
 * prints.
 *
 * Cluster F did not replace this. It turned out the console WAS the real sink:
 * `observability` is enabled in wrangler.jsonc, so Workers Logs retains these
 * lines and Logpush ships them, and swapping console.log for a database write
 * would have traded a sink that survives the Worker crashing for one that does
 * not.
 *
 * What Cluster F added is a MIRROR, in audit-log.ts, for a different reason
 * than durability: the nightly sweep has to be able to read its own trail, or
 * it reports every overdue case again every night. Use `recordAudit()` there
 * — for lines something later needs to query — and this everywhere else.
 */

export type AuditOutcome = "success" | "rejected" | "failure";

export interface AuditLine {
  /** Who acted: a reviewer id, or "public" for an unauthenticated reporter. */
  readonly actor: string;
  /** What they did, in verb_noun form: submit_report, claim_case, rule_case. */
  readonly action: string;
  /** What it happened to: a case reference, a document id, a route. */
  readonly target: string;
  readonly outcome: AuditOutcome;
  /** Anything else worth keeping. Never put personal data here. */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export function audit(line: AuditLine): void {
  const record = {
    actor: line.actor,
    action: line.action,
    target: line.target,
    timestamp: new Date().toISOString(),
    outcome: line.outcome,
    ...(line.detail === undefined ? {} : { detail: line.detail }),
  };
  // console IS the audit sink. See the note above — that is not a placeholder.
  console.log(`[AUDIT] ${JSON.stringify(record)}`);
}

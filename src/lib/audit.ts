/**
 * CLAUDE.md non-negotiable #9: every mutation emits a structured audit line —
 * a single-line JSON with actor, action, target, timestamp, outcome, prefixed
 * [AUDIT].
 *
 * Single-line is not a stylistic preference. Log shippers split on newlines,
 * so a pretty-printed record arrives as eight unparseable fragments. The
 * prefix exists so the line can be grepped out of everything else a Worker
 * prints.
 *
 * In Cluster F this gains a real sink. The shape does not change when it
 * does, which is the point of pinning it now.
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
  // console IS the audit sink until Cluster F gives it a real one.
  console.log(`[AUDIT] ${JSON.stringify(record)}`);
}

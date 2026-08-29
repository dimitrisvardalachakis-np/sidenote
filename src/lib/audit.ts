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
 *
 * There is now a SECOND sink, optional and installed at runtime. The console
 * line is still the primary record and still emitted first; the sink exists so
 * a reviewer can read the trail for a case on the case screen, which
 * non-negotiable #9 makes possible and no screen previously used. It is
 * registered rather than imported so this module stays free of `node:fs` and
 * can keep running anywhere — a Worker, a test, the browser bundle.
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

/** A line after the emitter has stamped it. What a sink receives. */
export interface AuditRecord {
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly timestamp: string;
  readonly outcome: AuditOutcome;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export type AuditSink = (record: AuditRecord) => void;

let sink: AuditSink | null = null;

/**
 * Install a second destination for audit lines. Null removes it.
 *
 * Registration rather than a direct import so this module never depends on a
 * filesystem. `store/audit-store.ts` installs itself; nothing else should.
 */
export function setAuditSink(next: AuditSink | null): void {
  sink = next;
}

export function audit(line: AuditLine): void {
  const record: AuditRecord = {
    actor: line.actor,
    action: line.action,
    target: line.target,
    timestamp: new Date().toISOString(),
    outcome: line.outcome,
    ...(line.detail === undefined ? {} : { detail: line.detail }),
  };
  // console is still the primary sink, and it is written FIRST — a failing
  // journal must never cost the line that non-negotiable #9 actually requires.
  console.log(`[AUDIT] ${JSON.stringify(record)}`);

  /*
    A sink may not break a mutation. The audit line is a record OF a write that
    has already happened; throwing here would turn a full disk into a failed
    claim, which inverts the relationship between the two.
  */
  try {
    sink?.(record);
  } catch {
    // Deliberately silent: the console line above is the record that matters.
  }
}

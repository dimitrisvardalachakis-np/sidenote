import "server-only";
import { alreadyRecorded, recordAudit } from "@/lib/audit-log";
import { getCaseCoordination } from "@/lib/coordinator";
import { getAssessmentStore } from "@/lib/store/assessment-store";
import { getCaseStore } from "@/lib/store/case-store";
import {
  anyReactionSerious,
  expeditedClock,
  expeditedDeadline,
  ruledListedness,
  type Case,
  type IsoDate,
} from "@/lib/schemas";

/**
 * The nightly deadline sweep.
 *
 * CLAUDE.md: "Nightly deadline sweep; nightly label diff re-flag | Cron,
 * UPSERT-on-conflict".
 *
 * WHY THIS EXISTS WHEN THE DURABLE OBJECT ALREADY HAS AN ALARM.
 *
 * The alarm is precise: it fires for one case at the moment its 15-day
 * deadline passes. But it only exists if something armed it, and the list of
 * ways it might not have been armed is not short — a case imported before the
 * coordinator existed, a ruling recorded while the arming write failed, a
 * deploy in between. The sweep is coarse and sees everything.
 *
 * A regulatory deadline is exactly the kind of thing that deserves two
 * independent ways of being noticed, and they are independent: the alarm lives
 * in Durable Object storage and the sweep reads D1.
 *
 * IDEMPOTENT, BECAUSE IT RUNS EVERY NIGHT FOREVER.
 *
 * Re-arming a clock with the same deadline is a no-op by construction — the
 * DO stores `dueOn`, a date, not a duration, so writing the same date twice
 * changes nothing and emits nothing. And an overdue case is reported ONCE,
 * checked against the audit trail, because an alert that fires every night for
 * three weeks is an alert nobody reads. That is worse than no alert: it looks
 * like coverage.
 */

export interface SweepReport {
  readonly examined: number;
  readonly armed: number;
  readonly overdue: number;
  readonly newlyReported: number;
}

export async function runDeadlineSweep(today: IsoDate): Promise<SweepReport> {
  const store = await getCaseStore();
  const cases = await store.list();

  // Settled cases have no clock left to run. `reported` and `closed` are
  // terminal, and re-arming an alarm for a case that has already gone to the
  // regulator would be alerting about work that is done.
  const open = cases.filter(
    (record) => record.status !== "reported" && record.status !== "closed",
  );

  /*
    Through the store, not straight into D1.

    This read `assessmentsForCases` directly, which answers from D1 and only
    from D1 — while every reviewer assessment was written through the store.
    With no D1 bound the map came back empty whatever anybody had done, so
    `listed` was null for every case, `applies` was false for every case, and
    the expedited clock this sweep exists to arm could never arm at all. With
    D1 bound it was empty for a different reason: the store had no D1 branch,
    so the write went to per-isolate memory.

    One interface over one table now, so the sweep sees what the reviewer
    wrote, whichever backing this is running on.
  */
  const assessments = await (await getAssessmentStore()).getMany(
    open.map((c) => c.id),
  );
  const coordination = await getCaseCoordination();

  let armed = 0;
  let overdue = 0;
  let newlyReported = 0;

  for (const record of open) {
    const assessment = assessments.get(record.id);

    /**
     * A case with no assessment yet is NOT given a clock.
     *
     * "Serious and unlisted" is the condition, and until a human has ruled,
     * `unlisted` is not established — the model may have suggested it, and
     * non-negotiable #4 says the model never decides. Arming on a suggestion
     * would put a red overdue marker on a case nobody has looked at, and
     * teach reviewers that red does not mean what it says.
     */
    const listed =
      assessment === undefined ? null : ruledListedness(assessment);
    const applies = listed === "unlisted" && anyReactionSerious(record.reactions);

    // UPSERT-on-conflict, in the sense CLAUDE.md means: running this twice
    // leaves the same state as running it once.
    await coordination.armClock(
      record.id,
      record.reference,
      applies ? expeditedDeadline(record.receivedAt) : null,
    );
    if (applies) armed += 1;

    if (!applies) continue;

    const clock = expeditedClock(record, true, today);
    if (clock.state !== "overdue") continue;
    overdue += 1;

    if (await reportOverdue(record, clock.dueOn, clock.daysOverdue)) {
      newlyReported += 1;
    }
  }

  await recordAudit({
    actor: "system",
    action: "deadline_sweep",
    target: today,
    outcome: "success",
    detail: {
      examined: open.length,
      armed,
      overdue,
      newlyReported,
    },
  });

  return { examined: open.length, armed, overdue, newlyReported };
}

/** Once per case. Returns true if this was the first time. */
async function reportOverdue(
  record: Case,
  dueOn: IsoDate,
  daysOverdue: number,
): Promise<boolean> {
  // Anything already recorded is not recorded again. The window is generous
  // rather than exact: a sweep that ran twice in one night because of a retry
  // must not produce two alerts.
  const since = "1970-01-01T00:00:00.000Z";
  if (await alreadyRecorded("expedited_overdue", record.reference, since)) {
    return false;
  }

  await recordAudit({
    actor: "system",
    action: "expedited_overdue",
    target: record.reference,
    outcome: "failure",
    detail: { dueOn, daysOverdue, receivedAt: record.receivedAt },
  });
  return true;
}

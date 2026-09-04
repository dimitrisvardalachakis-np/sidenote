import "server-only";
import { recordAudit } from "@/lib/audit-log";
import type { IsoDate } from "@/lib/schemas";
import { todayInAthens } from "@/lib/format/datetime";
import { runDeadlineSweep } from "./deadline-sweep";
import { runLabelDiff } from "./label-diff";

/**
 * Cron triggers arrive here.
 *
 * Dispatched on the cron EXPRESSION rather than on a job name, because that is
 * what Cloudflare actually passes, and inventing a name in between means two
 * places to change a schedule and one of them getting forgotten. The
 * expressions are the ones in wrangler.jsonc, and the fallback runs both
 * sweeps: an expression we do not recognise is a schedule somebody added
 * without wiring it up, and doing nothing would be indistinguishable from
 * working.
 */

export const CRON = {
  /** 02:00 UTC — after the day has rolled over everywhere it matters. */
  deadlineSweep: "0 2 * * *",
  /** 03:00 UTC — an hour later, so the two never contend for the database. */
  labelDiff: "0 3 * * *",
} as const;

/**
 * The scheduled day, or today when the platform hands us something absurd.
 *
 * Athens civil date, the same one the queue and the case screen count from.
 * Both crons fire in the small hours UTC, where the two calendars happen to
 * agree — but "happens to agree" is not a property to leave a deadline sweep
 * resting on. A sweep reasoning about a different day than the screen showing
 * the deadline is how a case reads "due today" and is never swept.
 */
function isoDateOf(scheduledTime: number): IsoDate {
  const at = new Date(scheduledTime);
  return Number.isFinite(at.getTime())
    ? todayInAthens(at)
    : todayInAthens();
}

export async function runScheduled(
  cron: string,
  _env: CloudflareEnv,
  scheduledTime: number,
): Promise<void> {
  // The date the sweep reasons about comes from the trigger, not from
  // `new Date()`. A cron that fires late — and they do — should still be
  // computing deadlines against the day it was scheduled for, and passing it
  // in is also what lets the sweep be tested without pinning the clock.
  //
  // Guarded, and INSIDE the try, because `new Date(NaN).toISOString()` throws
  // a RangeError. Left outside, that one line escaped the catch below and took
  // the whole handler down before it could record anything — the exact silent
  // failure the rest of this function exists to prevent. Found by the test
  // that was written to prove the catch worked.
  try {
    const today: IsoDate = isoDateOf(scheduledTime);

    switch (cron) {
      case CRON.deadlineSweep:
        await runDeadlineSweep(today);
        return;
      case CRON.labelDiff:
        await runLabelDiff();
        return;
      default:
        await recordAudit({
          actor: "system",
          action: "cron_unrecognised",
          target: cron,
          outcome: "failure",
          detail: { ranBoth: true },
        });
        await runDeadlineSweep(today);
        await runLabelDiff();
        return;
    }
  } catch (error) {
    // A cron failure is invisible by default: nobody is watching, and the next
    // run is 24 hours away. So it is recorded rather than allowed to unwind
    // into a stack trace nobody reads.
    await recordAudit({
      actor: "system",
      action: "cron_failed",
      target: cron,
      outcome: "failure",
      detail: {
        error: error instanceof Error ? error.message : "unknown",
      },
    });
  }
}

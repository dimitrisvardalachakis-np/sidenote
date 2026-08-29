/**
 * A queue row's facts, computed once.
 *
 * The queue page used to recompute the expedited clock inside every filter —
 * twice per entry for the "on the clock" count alone — and then a third time
 * inside the sort comparator. Each of those is a date parse per case per
 * render, and worse, each was a separate chance for two of them to disagree
 * about what a row is.
 *
 * So: one pass builds a `QueueRow` carrying everything the screen asks about a
 * case, and filtering, counting and sorting all read the same values. Pure over
 * its inputs, `today` included, so it can be tested without a clock.
 */
import {
  anyReactionSerious,
  caseValidity,
  documentStance,
  expeditedClock,
  flaggedCriteria,
  isSerious,
  readingsDiverge,
  ruledExpectedness,
  ruledListedness,
  sourcesDisagree,
  type Case,
  type ExpeditedClock,
  type IsoDate,
} from "@/lib/schemas";
import type { CaseClaim } from "@/lib/case/claim";
import type { QueueEntry } from "./entries";

export interface QueueRow {
  readonly entry: QueueEntry;
  readonly record: Case;
  /** Null when nobody has assessed it, so no clock can honestly be computed. */
  readonly clock: ExpeditedClock | null;
  readonly serious: boolean;
  readonly seriousCount: number;
  readonly assessed: boolean;
  /** A reviewer's ruling, or null. The model never contributes one. */
  readonly listedness: string | null;
  /** True when the ruling splits the sources, or the readings diverge. */
  readonly disagrees: boolean;
  /** The four minimum criteria that are still missing. */
  readonly missing: readonly string[];
  readonly claim: CaseClaim | null;
  /** Whole days since the case arrived, so staleness needs no arithmetic. */
  readonly ageDays: number;
  /** Arrived since the reviewer last looked. */
  readonly isNew: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function wholeDaysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

export interface BuildRowsInput {
  readonly entries: readonly QueueEntry[];
  readonly today: IsoDate;
  readonly claims: ReadonlyMap<string, CaseClaim>;
  /**
   * When the reviewer last looked at the queue, as an ISO timestamp. Null on a
   * first visit, which marks nothing rather than marking everything — a screen
   * where all sixteen cases are new is the same as one where none is.
   */
  readonly lastVisit: string | null;
}

export function buildRows(input: BuildRowsInput): readonly QueueRow[] {
  const { entries, today, claims, lastVisit } = input;

  return entries.map((entry) => {
    const { record, assessment } = entry;
    const listedness =
      assessment === null ? null : ruledListedness(assessment);
    const clock =
      assessment === null
        ? null
        : expeditedClock(record, listedness === "unlisted", today);

    /*
      Two ways the sources can be at odds, and the row treats them the same
      because to somebody scanning a list they mean the same thing: this case
      is the interesting kind. They render differently on the case screen,
      where the difference is worth the space.
    */
    const disagrees =
      assessment !== null &&
      (sourcesDisagree(assessment) ||
        (readingsDiverge(assessment) &&
          (documentStance(assessment.listedness) === "describes" ||
            documentStance(assessment.expectedness) === "describes")));

    const validity = caseValidity({
      patient: record.patient,
      reporter: record.reporter,
      drugs: record.drugs,
      reactions: record.reactions,
    });

    return {
      entry,
      record,
      clock,
      serious: record.reactions.some((r) => isSerious(r.seriousness)),
      seriousCount: record.reactions.reduce(
        (total, r) => total + flaggedCriteria(r.seriousness).length,
        0,
      ),
      assessed: assessment !== null,
      listedness,
      disagrees,
      missing: validity.missing,
      claim: claims.get(record.id) ?? null,
      ageDays: wholeDaysBetween(record.receivedAt, today),
      isNew: lastVisit !== null && record.createdAt > lastVisit,
    };
  });
}

/** Whether any reaction on this case is serious. Re-exported for the page. */
export { anyReactionSerious, ruledExpectedness };

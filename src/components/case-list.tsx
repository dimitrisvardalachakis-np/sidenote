import Link from "next/link";
import {
  SERIOUSNESS_CRITERIA,
  caseValidity,
  expeditedClock,
  flaggedCriteria,
  isSerious,
  sourcesDisagree,
  standingListedness,
  type Case,
  type ExpeditedClock,
  type IsoDate,
} from "@/lib/schemas";
import type { QueueEntry } from "@/lib/queue/entries";

/**
 * How a clock reads on screen.
 *
 * CLAUDE.md reserves --signal for "expedited or overdue", so BOTH a running
 * expedited clock and an overdue one earn the red. Everything else is slate.
 * That is the whole point of reserving it: red on this screen always means a
 * regulatory deadline and never anything else.
 *
 * The label never says only "3d". A bare number is ambiguous about direction,
 * and the one thing a reviewer must not misread is whether a deadline has
 * already passed.
 */
export function clockLabel(clock: ExpeditedClock): {
  readonly text: string;
  readonly urgent: boolean;
} {
  switch (clock.state) {
    case "overdue":
      return {
        text: `${clock.daysOverdue}d overdue`,
        urgent: true,
      };
    case "running":
      return {
        text:
          clock.daysRemaining === 0
            ? "due today"
            : `${clock.daysRemaining}d left`,
        urgent: true,
      };
    case "not_applicable":
      return { text: "no clock", urgent: false };
  }
}

/**
 * What an unassessed case shows instead of a countdown.
 *
 * Deliberately NOT --signal. A serious case that nobody has assessed may well
 * turn out to be expedited — and if it does, the clock has been running since
 * Day 0 — but "might be urgent" and "is overdue" are different claims, and
 * spending the red on the first devalues it for the second. It gets emphasis
 * in --ink instead, and sorts directly below the real deadlines.
 */
function unassessedLabel(record: Case): { text: string; urgent: boolean } {
  const serious = record.reactions.some((r) => isSerious(r.seriousness));
  return {
    text: serious ? "assess now" : "not assessed",
    urgent: false,
  };
}

function CountdownRail({ clock }: { clock: ExpeditedClock | null }) {
  /**
   * The rail is the left edge of the row, not a badge.
   *
   * A reviewer scanning a queue reads down the left margin; putting urgency
   * there means it is legible without reading a single word, and it costs no
   * horizontal space in a table that is already dense.
   */
  const urgent = clock !== null && clock.state !== "not_applicable";
  return (
    <span
      aria-hidden="true"
      className={[
        "block w-0.5 self-stretch",
        urgent ? "bg-signal" : "bg-transparent",
      ].join(" ")}
    />
  );
}

export function CaseRow({
  seeded,
  today,
  compact,
  current,
}: {
  seeded: QueueEntry;
  today: IsoDate;
  compact: boolean;
  current: boolean;
}) {
  const { record, assessment } = seeded;
  // Not assessed yet: nobody has looked, so nothing can be concluded about
  // listedness and no clock can be computed. See QueueEntry.
  const listed = assessment === null ? null : standingListedness(assessment);
  const clock =
    assessment === null
      ? null
      : expeditedClock(record, listed === "unlisted", today);
  const label = clock === null ? unassessedLabel(record) : clockLabel(clock);
  const validity = caseValidity(record);
  const flags = record.reactions.flatMap((r) => flaggedCriteria(r.seriousness));
  const disagrees = assessment !== null && sourcesDisagree(assessment);

  return (
    <li className="border-b border-rule">
      <Link
        href={`/case/${record.id}`}
        className={[
          "flex gap-3 hover:bg-row-hover",
          current ? "bg-row-active" : "",
        ].join(" ")}
      >
        <CountdownRail clock={clock} />
        <div className="min-w-0 flex-1 py-2 pr-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-meta text-slate">
              {record.reference}
            </span>
            <span
              className={[
                "shrink-0 text-meta tabular-nums",
                label.urgent ? "font-medium text-signal" : "text-slate",
              ].join(" ")}
            >
              {label.text}
            </span>
          </div>

          <p className="mt-0.5 truncate text-base">
            {record.reactions[0]?.verbatimTerm ?? "No reaction recorded"}
          </p>

          <p className="mt-0.5 truncate text-meta text-slate">
            {record.drugs[0]?.reportedName ?? "No drug"}
            {flags.length > 0 &&
              ` · ${flags.length} of ${SERIOUSNESS_CRITERIA.length} serious`}
            {listed !== null && ` · ${listed}`}
          </p>

          {!compact && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-micro uppercase tracking-label text-slate">
              <span>{record.status.replace("_", " ")}</span>
              <span>received {record.receivedAt}</span>
              {record.assignedTo !== null && (
                <span className="text-steady">claimed</span>
              )}
            </div>
          )}

          {/* The two things a reviewer must never scroll past. */}
          {disagrees && (
            <p className="mt-1 text-meta font-medium text-ink">
              Sources disagree
            </p>
          )}
          {!validity.isValid && (
            <p className="mt-1 text-meta text-ink">
              Incomplete — missing {validity.missing.join(", ")}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

export function CaseList({
  cases,
  today,
  compact = false,
  currentId = null,
}: {
  cases: readonly QueueEntry[];
  today: IsoDate;
  compact?: boolean;
  currentId?: string | null;
}) {
  return (
    <ul className="border-t border-rule">
      {cases.map((seeded) => (
        <CaseRow
          key={seeded.record.id}
          seeded={seeded}
          today={today}
          compact={compact}
          current={seeded.record.id === currentId}
        />
      ))}
    </ul>
  );
}

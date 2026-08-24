import { requireSession } from "@/lib/auth";
import { CaseList } from "@/components/case-list";
import { loadQueue, type QueueEntry } from "@/lib/queue/entries";
import {
  expeditedClock,
  isSerious,
  sourcesDisagree,
  standingListedness,
  type IsoDate,
} from "@/lib/schemas";

/**
 * The reviewer queue. A Server Component — the case data never crosses to the
 * client as props anyone could tamper with.
 *
 * Ordering is the product decision on this screen. Cases sort by how close
 * they are to a regulatory deadline, so the top of the list is always the
 * thing most likely to be late.
 */
export default async function QueuePage() {
  const session = await requireSession();
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const entries = await loadQueue(today);
  const sorted = [...entries].sort((a, b) => rank(a, today) - rank(b, today));

  const clockOf = (entry: QueueEntry) =>
    entry.assessment === null
      ? null
      : expeditedClock(
          entry.record,
          standingListedness(entry.assessment) === "unlisted",
          today,
        );

  const onClock = entries.filter(
    (e) => clockOf(e)?.state !== undefined && clockOf(e)?.state !== "not_applicable",
  );
  const overdue = entries.filter((e) => clockOf(e)?.state === "overdue");
  const disagreeing = entries.filter(
    (e) => e.assessment !== null && sourcesDisagree(e.assessment),
  );
  const unassessed = entries.filter((e) => e.assessment === null);

  return (
    <main className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-title font-medium">Queue</h1>
        <p className="text-meta text-slate">{session.displayName}</p>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 border-y border-rule py-2">
        <Stat label="Cases">{entries.length}</Stat>
        <Stat label="On the clock">{onClock.length}</Stat>
        <Stat label="Overdue" urgent={overdue.length > 0}>
          {overdue.length}
        </Stat>
        <Stat label="Sources disagree">{disagreeing.length}</Stat>
        <Stat label="Not assessed">{unassessed.length}</Stat>
      </dl>

      <p className="mt-3 text-meta text-slate">
        Sorted by deadline. Cases nobody has assessed sit below live deadlines
        but above settled cases — until one is assessed, there is no way to know
        whether its clock is already running.
      </p>

      <div className="mt-2">
        <CaseList cases={sorted} today={today} />
      </div>
    </main>
  );
}

/**
 * Sort key. Overdue first (most overdue first), then running (least time
 * first), then unassessed, then everything settled.
 *
 * Unassessed sits above settled deliberately: a serious case nobody has looked
 * at could turn out to be expedited, and if it does, Day 0 was whenever it
 * arrived — not whenever someone gets round to it.
 */
function rank(entry: QueueEntry, today: IsoDate): number {
  if (entry.assessment === null) {
    return entry.record.reactions.some((r) => isSerious(r.seriousness))
      ? 100
      : 500;
  }
  const clock = expeditedClock(
    entry.record,
    standingListedness(entry.assessment) === "unlisted",
    today,
  );
  switch (clock.state) {
    case "overdue":
      return -1000 - clock.daysOverdue;
    case "running":
      return clock.daysRemaining;
    case "not_applicable":
      return 1000;
  }
}

function Stat({
  label,
  children,
  urgent = false,
}: {
  label: string;
  children: React.ReactNode;
  urgent?: boolean;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-label text-slate">
        {label}
      </dt>
      <dd
        className={[
          "text-figure tabular-nums leading-none",
          urgent ? "text-signal" : "text-ink",
        ].join(" ")}
      >
        {children}
      </dd>
    </div>
  );
}

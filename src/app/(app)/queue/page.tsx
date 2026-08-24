import { requireSession } from "@/lib/auth";
import { CaseList } from "@/components/case-list";
import { buildSeedCases } from "@/lib/fixtures/seed";
import {
  expeditedClock,
  sourcesDisagree,
  standingListedness,
  type IsoDate,
} from "@/lib/schemas";

/**
 * The reviewer queue. A Server Component, as the brief specifies — the case
 * data never crosses to the client as props anyone could tamper with.
 *
 * Ordering is the product decision on this screen. Cases are sorted by how
 * close they are to a regulatory deadline, so the top of the list is always
 * the thing most likely to be late. Everything without a clock falls below
 * everything with one, regardless of age: a three-week-old non-serious case
 * genuinely is less urgent than a two-day-old expedited one.
 */
export default async function QueuePage() {
  const session = await requireSession();
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const cases = buildSeedCases(today);

  const sorted = [...cases].sort((a, b) => rank(a, today) - rank(b, today));

  const expedited = cases.filter(
    (c) =>
      expeditedClock(
        c.record,
        standingListedness(c.assessment) === "unlisted",
        today,
      ).state !== "not_applicable",
  );
  const overdue = expedited.filter(
    (c) =>
      expeditedClock(
        c.record,
        standingListedness(c.assessment) === "unlisted",
        today,
      ).state === "overdue",
  );
  const disagreeing = cases.filter((c) => sourcesDisagree(c.assessment));

  return (
    <main className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-title font-medium">Queue</h1>
        <p className="text-meta text-slate">{session.displayName}</p>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 border-y border-rule py-2">
        <Stat label="Cases">{cases.length}</Stat>
        <Stat label="On the clock">{expedited.length}</Stat>
        <Stat label="Overdue" urgent={overdue.length > 0}>
          {overdue.length}
        </Stat>
        <Stat label="Sources disagree">{disagreeing.length}</Stat>
      </dl>

      <p className="mt-3 text-meta text-slate">
        Sorted by deadline. Cases with no expedited clock sit below those that
        have one.
      </p>

      <div className="mt-2">
        <CaseList cases={sorted} today={today} />
      </div>
    </main>
  );
}

/**
 * Sort key: overdue first (most overdue first), then running (least time
 * first), then everything else by age.
 */
function rank(
  seeded: ReturnType<typeof buildSeedCases>[number],
  today: IsoDate,
): number {
  const clock = expeditedClock(
    seeded.record,
    standingListedness(seeded.assessment) === "unlisted",
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

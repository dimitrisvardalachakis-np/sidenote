import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { QueueSearch } from "@/components/queue-search";
import { QueueTable } from "@/components/queue-table";
import { loadQueue } from "@/lib/queue/entries";
import { buildRows } from "@/lib/queue/view";
import {
  FILTER_LABELS,
  QUEUE_FILTERS,
  applyFilters,
  applyQuery,
  countAll,
  parseFilters,
  planSentence,
  serialiseFilters,
  type QueueFilter,
} from "@/lib/queue/filter";
import {
  QUEUE_SORTS,
  parseSort,
  sortRows,
  type QueueSort,
} from "@/lib/queue/sort";
import { getClaimStore } from "@/lib/store/claim-store";
import { readLastVisit, recordVisit } from "@/lib/queue/last-visit";
import type { IsoDate } from "@/lib/schemas";

/**
 * The reviewer queue. A Server Component — the case data never crosses to the
 * client as props anyone could tamper with, and the filtering happens here.
 *
 * The five figures used to be numbers you could not act on: Overdue said 1 and
 * would not tell you which. They are filters now, held in the URL so the
 * server keeps doing the work and "overdue and unclaimed" is a link somebody
 * can bookmark. Each figure still counts the whole queue — a filter that
 * changes its own label is unreadable.
 *
 * Ordering is the other product decision on this screen. Cases sort by how
 * close they are to a regulatory deadline, so the top of the list is always
 * the thing most likely to be late.
 */
export async function generateMetadata(): Promise<Metadata> {
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const entries = await loadQueue(today);
  const rows = buildRows({
    entries,
    today,
    claims: await getClaimStore().all(),
    lastVisit: null,
  });
  const live = rows.filter(
    (row) => row.clock !== null && row.clock.state !== "not_applicable",
  ).length;

  return {
    title:
      live === 0 ? "Queue — SideNote" : `Queue · ${live} on the clock — SideNote`,
  };
}

export default async function QueuePage({
  searchParams,
}: PageProps<"/queue">) {
  const session = await requireSession();
  const params = await searchParams;
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const filters = parseFilters(readParam(params["filter"]));
  const sort = parseSort(readParam(params["sort"]));
  const query = readParam(params["q"]) ?? "";
  const jump = readJumpResult(params);

  /*
    When this reviewer last looked, read before it is written — otherwise
    every case would be "new since your last visit" only until the first
    render, and never again.
  */
  const lastVisit = await readLastVisit(session.reviewerId);

  const entries = await loadQueue(today);
  const rows = buildRows({
    entries,
    today,
    claims: await getClaimStore().all(),
    lastVisit,
  });

  const context = { reviewerId: session.reviewerId };
  const counts = countAll(rows, context);
  const visible = sortRows(
    applyQuery(applyFilters(rows, filters, context), query),
    sort,
  );

  // Stamped after the counts are taken, so "new" survives this render.
  await recordVisit(session.reviewerId);

  const href = (over: {
    filters?: readonly QueueFilter[];
    sort?: QueueSort;
    q?: string;
  }) => {
    const next = new URLSearchParams();
    const f = serialiseFilters(over.filters ?? filters);
    if (f.length > 0) next.set("filter", f);
    const s = over.sort ?? sort;
    if (s !== "clock") next.set("sort", s);
    const q = over.q ?? query;
    if (q.length > 0) next.set("q", q);
    const search = next.toString();
    return search.length === 0 ? "/queue" : `/queue?${search}`;
  };

  /** Turning a filter on or off, keeping everything else. */
  const toggleHref = (filter: QueueFilter) =>
    href({
      filters: filters.includes(filter)
        ? filters.filter((f) => f !== filter)
        : [...filters, filter],
    });

  /*
    One href per sortable column, built here rather than handed over as a
    callback. A function cannot cross into a Client Component, and the failure
    is a runtime error rather than a build one.
  */
  const sortHrefs = Object.fromEntries(
    QUEUE_SORTS.map((column) => [column, href({ sort: column })]),
  ) as Record<QueueSort, string>;

  const filtered = filters.length > 0 || query.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-h1 font-medium">Queue</h1>
        <p className="text-meta text-slate">{session.displayName}</p>
      </div>

      {/*
        What to do first, in a sentence, above the figures rather than instead
        of them. Five numbers tell a reviewer what is there; this tells them
        where to start.
      */}
      <p className="mt-1 text-base">{planSentence(rows, counts)}</p>

      {jump !== null && (
        <p
          role="status"
          className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2 text-meta"
        >
          {jump.kind === "ambiguous" ? (
            <>
              <span className="font-mono text-ink">{jump.typed}</span> matches
              more than one case, so nothing was opened. Type the full
              reference.
            </>
          ) : (
            <>
              No case matches{" "}
              <span className="font-mono text-ink">{jump.typed}</span>. It may
              be in another system, or the number may have a digit out.
            </>
          )}
        </p>
      )}

      {/*
        The figures, as filters. `flex-wrap` with a small gap rather than the
        old `gap-x-8`, which wrapped into an unreadable stagger at about 800px.
      */}
      <div className="mt-3 flex flex-wrap items-stretch gap-2 border-y border-rule py-2">
        {QUEUE_FILTERS.map((filter) => (
          <FilterChip
            key={filter}
            href={toggleHref(filter)}
            label={FILTER_LABELS[filter]}
            count={counts[filter]}
            on={filters.includes(filter)}
            // --signal is the regulatory clock, and Overdue IS that clock.
            urgent={filter === "overdue" && counts.overdue > 0}
          />
        ))}
        <span className="flex items-center text-micro uppercase tracking-label text-slate">
          {visible.length} of {rows.length} shown
        </span>
        {/* Only when there is something to clear. */}
        {filtered && (
          <Link
            href="/queue"
            className="flex items-center rounded-soft border border-rule px-2 text-micro uppercase tracking-label text-slate hover:border-ink hover:text-ink"
          >
            Clear
          </Link>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <QueueSearch
          defaultValue={query}
          hidden={{
            ...(filters.length > 0 ? { filter: serialiseFilters(filters) } : {}),
            ...(sort !== "clock" ? { sort } : {}),
          }}
        />
      </div>

      <div className="mt-3">
        <QueueTable
          rows={visible}
          sort={sort}
          sortHrefs={sortHrefs}
          emptyMessage={
            rows.length === 0
              ? "No cases in the queue."
              : "No cases match these filters."
          }
          clearHref={filtered ? "/queue" : null}
        />
      </div>
    </main>
  );
}

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * What the jump box reported, if it reported anything.
 *
 * Only the two values the route actually produces are rendered: `jump` arrives
 * as a query parameter, so anyone can type one.
 */
function readJumpResult(params: {
  [key: string]: string | string[] | undefined;
}): { kind: "not_found" | "ambiguous"; typed: string } | null {
  const kind = params["jump"];
  if (kind !== "not_found" && kind !== "ambiguous") return null;
  const raw = params["ref"];
  const typed = typeof raw === "string" ? raw.trim() : "";
  if (typed.length === 0) return null;
  return { kind, typed };
}

function FilterChip({
  href,
  label,
  count,
  on,
  urgent,
}: {
  href: string;
  label: string;
  count: number;
  on: boolean;
  urgent: boolean;
}) {
  return (
    <Link
      href={href}
      aria-pressed={on}
      className={[
        "flex items-baseline gap-2 rounded-soft border px-2 py-1",
        on
          ? "border-steady bg-steady-wash"
          : "border-rule hover:border-ink hover:bg-row-hover",
      ].join(" ")}
    >
      <span
        className={[
          "text-base tabular-nums",
          urgent ? "text-signal" : on ? "text-steady" : "text-ink",
        ].join(" ")}
      >
        {count}
      </span>
      <span
        className={[
          "text-micro uppercase tracking-label",
          on ? "text-steady" : "text-slate",
        ].join(" ")}
      >
        {label}
      </span>
    </Link>
  );
}

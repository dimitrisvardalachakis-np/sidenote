/**
 * Turning the queue's five figures into things you can act on.
 *
 * They were exactly the right five questions — cases, on the clock, overdue,
 * sources disagree, not assessed — and every one of them was a number you
 * could not click. Overdue said 1 and would not tell you which. A queue you
 * can only read is a report, not a worklist.
 *
 * Filters live in the URL, which is what keeps the page a Server Component:
 * the server does the filtering, a reviewer can bookmark "overdue and
 * unclaimed", and the back button behaves.
 *
 * They combine with AND. Each figure still counts THE WHOLE QUEUE rather than
 * the filtered subset — a filter that changes its own label is unreadable, and
 * a reviewer needs to know that turning one on hid eleven cases.
 */
import type { QueueRow } from "./view";

export const QUEUE_FILTERS = [
  "on_clock",
  "overdue",
  "disagree",
  "unassessed",
  "mine",
  "unclaimed",
  "new",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const FILTER_LABELS: Readonly<Record<QueueFilter, string>> = {
  on_clock: "On the clock",
  overdue: "Overdue",
  disagree: "Sources disagree",
  unassessed: "Not assessed",
  mine: "Mine",
  unclaimed: "Unclaimed",
  new: "New",
};

export interface FilterContext {
  /** Who is asking, so "Mine" means something. */
  readonly reviewerId: string;
}

const PREDICATES: Readonly<
  Record<QueueFilter, (row: QueueRow, context: FilterContext) => boolean>
> = {
  on_clock: (row) =>
    row.clock !== null && row.clock.state !== "not_applicable",
  overdue: (row) => row.clock?.state === "overdue",
  disagree: (row) => row.disagrees,
  unassessed: (row) => !row.assessed,
  mine: (row, context) => row.claim?.reviewerId === context.reviewerId,
  unclaimed: (row) => row.claim === null,
  new: (row) => row.isNew,
};

/** Only the names this module knows. A query parameter is user input. */
export function parseFilters(raw: string | undefined): readonly QueueFilter[] {
  if (raw === undefined || raw.length === 0) return [];
  const wanted = new Set(raw.split(","));
  return QUEUE_FILTERS.filter((filter) => wanted.has(filter));
}

export function serialiseFilters(filters: readonly QueueFilter[]): string {
  return QUEUE_FILTERS.filter((f) => filters.includes(f)).join(",");
}

/** Every active filter must pass. */
export function applyFilters(
  rows: readonly QueueRow[],
  filters: readonly QueueFilter[],
  context: FilterContext,
): readonly QueueRow[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((filter) => PREDICATES[filter](row, context)),
  );
}

/**
 * Does this case match what was typed?
 *
 * Reference, reaction, drug and reporter name — the four things a reviewer
 * would have in their head when they go looking. Case-insensitive substring,
 * because a queue search is for finding the row you already know exists, not
 * for ranking relevance; the retrieval module is where ranking belongs.
 */
export function matchesQuery(row: QueueRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  const haystacks = [
    row.record.reference,
    ...row.record.reactions.map((r) => r.verbatimTerm),
    ...row.record.reactions.map((r) => r.meddraPreferredTerm ?? ""),
    ...row.record.drugs.map((d) => d.reportedName),
    ...row.record.drugs.map((d) => d.activeSubstance ?? ""),
    row.record.reporter?.name ?? "",
  ];

  return haystacks.some((text) => text.toLowerCase().includes(needle));
}

export function applyQuery(
  rows: readonly QueueRow[],
  query: string,
): readonly QueueRow[] {
  return query.trim().length === 0
    ? rows
    : rows.filter((row) => matchesQuery(row, query));
}

/**
 * The counts, always over the WHOLE queue.
 *
 * Deliberately not over the filtered rows. "Overdue 1" has to keep saying 1
 * while you are looking at the one overdue case, or the number that told you
 * to click is the number that disappears when you do.
 */
export function countAll(
  rows: readonly QueueRow[],
  context: FilterContext,
): Readonly<Record<QueueFilter, number>> {
  const counts = {} as Record<QueueFilter, number>;
  for (const filter of QUEUE_FILTERS) {
    counts[filter] = rows.filter((row) =>
      PREDICATES[filter](row, context),
    ).length;
  }
  return counts;
}

/**
 * The plan sentence: what to do first, in words rather than five figures.
 *
 * Only the clauses that are true. A sentence reading "0 due today, 0 overdue"
 * is noise, and a reviewer opening a clear queue should be told it is clear.
 */
export function planSentence(
  rows: readonly QueueRow[],
  counts: Readonly<Record<QueueFilter, number>>,
): string {
  const dueToday = rows.filter(
    (row) => row.clock?.state === "running" && row.clock.daysRemaining === 0,
  ).length;

  const clauses: string[] = [];
  if (counts.overdue > 0) clauses.push(`${counts.overdue} overdue`);
  if (dueToday > 0) clauses.push(`${dueToday} due today`);
  if (counts.unassessed > 0) {
    clauses.push(`${counts.unassessed} nobody has assessed`);
  }
  if (counts.new > 0) clauses.push(`${counts.new} arrived since your last visit`);

  if (clauses.length === 0) {
    return rows.length === 0
      ? "Nothing in the queue."
      : "Nothing overdue and nothing unassessed.";
  }
  return `${clauses.join(", ")}.`;
}

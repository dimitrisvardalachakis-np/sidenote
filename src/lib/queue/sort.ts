/**
 * The order the queue works in.
 *
 * The default is by deadline, which is the product decision this screen is
 * built around: the top of the list is always the thing most likely to be
 * late. The alternatives exist because a reviewer sometimes has a different
 * question — "what came in this week", "everything for that drug" — and
 * neither is served by a deadline ordering.
 *
 * `rank` used to live in the page and recompute the expedited clock per
 * comparison. It reads a `QueueRow` now, where the clock was computed once.
 */
import type { QueueRow } from "./view";

export const QUEUE_SORTS = ["clock", "received", "drug", "status"] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

export const SORT_LABELS: Readonly<Record<QueueSort, string>> = {
  clock: "Clock",
  received: "Received",
  drug: "Drug",
  status: "Status",
};

export function parseSort(raw: string | undefined): QueueSort {
  return QUEUE_SORTS.find((sort) => sort === raw) ?? "clock";
}

/**
 * Deadline rank. Overdue first, most overdue first; then running, least time
 * first; then unassessed; then everything settled.
 *
 * Unassessed sits above settled deliberately: a serious case nobody has looked
 * at could turn out to be expedited, and if it does, Day 0 was whenever it
 * arrived — not whenever someone gets round to it.
 */
export function clockRank(row: QueueRow): number {
  if (row.clock === null) return row.serious ? 100 : 500;
  switch (row.clock.state) {
    case "overdue":
      return -1000 - row.clock.daysOverdue;
    case "running":
      return row.clock.daysRemaining;
    case "not_applicable":
      return 1000;
  }
}

const STATUS_ORDER: readonly string[] = [
  "received",
  "in_review",
  "assessed",
  "reported",
  "closed",
];

/**
 * Sort, stably, with a deterministic tie-break.
 *
 * The reference breaks every tie, so two runs over the same data produce the
 * same list. A queue whose rows shuffle between renders is one a reviewer
 * cannot keep their place in — and it would make the keyboard cursor land
 * somewhere different each time the page revalidated.
 */
export function sortRows(
  rows: readonly QueueRow[],
  sort: QueueSort,
): readonly QueueRow[] {
  const compare = (a: QueueRow, b: QueueRow): number => {
    switch (sort) {
      case "clock":
        return clockRank(a) - clockRank(b);
      case "received":
        // Newest first: "what has come in" is a question about recent arrivals.
        return b.record.receivedAt.localeCompare(a.record.receivedAt);
      case "drug":
        return (a.record.drugs[0]?.reportedName ?? "").localeCompare(
          b.record.drugs[0]?.reportedName ?? "",
        );
      case "status":
        return (
          STATUS_ORDER.indexOf(a.record.status) -
          STATUS_ORDER.indexOf(b.record.status)
        );
    }
  };

  return [...rows].sort(
    (a, b) => compare(a, b) || a.record.reference.localeCompare(b.record.reference),
  );
}

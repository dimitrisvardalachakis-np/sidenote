/**
 * The rules that turn a list into a worklist.
 *
 * Rows are built by hand here rather than through `buildRows`, because these
 * are claims about filtering and sorting, not about how a row is derived —
 * and a fixture that has to construct a whole Case to test "Overdue shows the
 * overdue ones" is a fixture nobody will keep up to date.
 */
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  applyQuery,
  countAll,
  matchesQuery,
  parseFilters,
  planSentence,
  serialiseFilters,
} from "./filter";
import { clockRank, parseSort, sortRows } from "./sort";
import type { QueueRow } from "./view";

const ME = "reviewer-demo";
const THEM = "reviewer-ao";
const context = { reviewerId: ME };

function row(over: Partial<QueueRow> & { reference: string }): QueueRow {
  const { reference, ...rest } = over;
  return {
    entry: {} as QueueRow["entry"],
    record: {
      reference,
      receivedAt: "2026-08-01",
      createdAt: "2026-08-01T00:00:00Z",
      status: "received",
      reactions: [{ verbatimTerm: "a rash", meddraPreferredTerm: null }],
      drugs: [{ reportedName: "Amoxil", activeSubstance: "amoxicillin" }],
      reporter: { name: "J. Rivera" },
    } as unknown as QueueRow["record"],
    clock: null,
    serious: false,
    seriousCount: 0,
    assessed: false,
    listedness: null,
    disagrees: false,
    missing: [],
    claim: null,
    ageDays: 0,
    isNew: false,
    ...rest,
  };
}

const overdue = row({
  reference: "SN-2026-000101",
  clock: { state: "overdue", dueOn: "2026-08-22", daysOverdue: 7 },
  assessed: true,
  serious: true,
});
const dueToday = row({
  reference: "SN-2026-000110",
  clock: { state: "running", dueOn: "2026-08-29", daysRemaining: 0 },
  assessed: true,
});
const settled = row({
  reference: "SN-2026-000200",
  clock: { state: "not_applicable" },
  assessed: true,
});
const unassessed = row({ reference: "SN-2026-500002" });
const mine = row({
  reference: "SN-2026-000300",
  assessed: true,
  clock: { state: "not_applicable" },
  claim: { reviewerId: ME, displayName: "Demo Reviewer", heldSince: "x" },
});
const theirs = row({
  reference: "SN-2026-000301",
  assessed: true,
  clock: { state: "not_applicable" },
  claim: { reviewerId: THEM, displayName: "A. Okonkwo", heldSince: "x" },
});

const ALL = [overdue, dueToday, settled, unassessed, mine, theirs];

describe("filters", () => {
  it("shows only the overdue ones in one click", () => {
    expect(
      applyFilters(ALL, ["overdue"], context).map((r) => r.record.reference),
    ).toEqual(["SN-2026-000101"]);
  });

  it("combines with AND", () => {
    const claimedOverdue = row({
      reference: "SN-2026-000999",
      clock: { state: "overdue", dueOn: "2026-08-22", daysOverdue: 2 },
      assessed: true,
      claim: { reviewerId: THEM, displayName: "A. Okonkwo", heldSince: "x" },
    });
    const rows = [...ALL, claimedOverdue];
    // Overdue AND unclaimed is one case, not two.
    expect(
      applyFilters(rows, ["overdue", "unclaimed"], context).map(
        (r) => r.record.reference,
      ),
    ).toEqual(["SN-2026-000101"]);
  });

  it("separates mine from unclaimed from theirs", () => {
    expect(applyFilters(ALL, ["mine"], context)).toEqual([mine]);
    expect(
      applyFilters(ALL, ["unclaimed"], context).map((r) => r.record.reference),
    ).not.toContain("SN-2026-000301");
  });

  it("counts on-the-clock as running or overdue, never settled", () => {
    const onClock = applyFilters(ALL, ["on_clock"], context);
    expect(onClock.map((r) => r.record.reference)).toEqual([
      "SN-2026-000101",
      "SN-2026-000110",
    ]);
  });

  it("returns everything when nothing is on", () => {
    expect(applyFilters(ALL, [], context)).toEqual(ALL);
  });

  /*
    THE rule about counts. A figure that changes when you click it is the
    figure that told you to click, disappearing. "Overdue 1" must keep saying
    1 while you are looking at the one overdue case.
  */
  it("counts the whole queue, not the filtered subset", () => {
    const counts = countAll(ALL, context);
    const filtered = applyFilters(ALL, ["overdue"], context);
    expect(filtered).toHaveLength(1);
    expect(countAll(ALL, context)).toEqual(counts);
    expect(counts.unassessed).toBe(1);
    expect(counts.on_clock).toBe(2);
  });
});

describe("filters in the URL", () => {
  it("round-trips", () => {
    expect(parseFilters(serialiseFilters(["overdue", "mine"]))).toEqual([
      "overdue",
      "mine",
    ]);
  });

  it("ignores names it does not know, because a query string is user input", () => {
    expect(parseFilters("overdue,rm -rf,mine")).toEqual(["overdue", "mine"]);
    expect(parseFilters("")).toEqual([]);
    expect(parseFilters(undefined)).toEqual([]);
  });

  it("serialises in a fixed order, so one set has one URL", () => {
    expect(serialiseFilters(["mine", "overdue"])).toBe(
      serialiseFilters(["overdue", "mine"]),
    );
  });
});

describe("search", () => {
  it("matches a reference, a reaction, a drug and a reporter", () => {
    expect(matchesQuery(overdue, "SN-2026-000101")).toBe(true);
    expect(matchesQuery(overdue, "rash")).toBe(true);
    expect(matchesQuery(overdue, "amoxil")).toBe(true);
    expect(matchesQuery(overdue, "rivera")).toBe(true);
  });

  it("matches an active substance, which is how a reviewer often thinks", () => {
    expect(matchesQuery(overdue, "amoxicillin")).toBe(true);
  });

  it("is case-insensitive and matches part of a word", () => {
    expect(matchesQuery(overdue, "AMOX")).toBe(true);
  });

  it("does not match something absent", () => {
    expect(matchesQuery(overdue, "hepalex")).toBe(false);
  });

  it("an empty query filters nothing out", () => {
    expect(applyQuery(ALL, "   ")).toEqual(ALL);
  });
});

describe("the plan sentence", () => {
  it("says what to do first, in words", () => {
    const counts = countAll(ALL, context);
    const sentence = planSentence(ALL, counts);
    expect(sentence).toContain("1 overdue");
    expect(sentence).toContain("1 due today");
    expect(sentence).toContain("1 nobody has assessed");
  });

  it("omits clauses that would say zero", () => {
    const rows = [settled];
    expect(planSentence(rows, countAll(rows, context))).toBe(
      "Nothing overdue and nothing unassessed.",
    );
  });

  it("says so when the queue is empty", () => {
    expect(planSentence([], countAll([], context))).toBe("Nothing in the queue.");
  });

  it("counts what arrived since the last visit", () => {
    const fresh = row({ reference: "SN-2026-000400", isNew: true });
    const rows = [settled, fresh];
    expect(planSentence(rows, countAll(rows, context))).toContain(
      "1 arrived since your last visit",
    );
  });
});

describe("sorting", () => {
  it("puts the most overdue first and settled last", () => {
    const sorted = sortRows(ALL, "clock").map((r) => r.record.reference);
    expect(sorted[0]).toBe("SN-2026-000101");
    expect(sorted.at(-1)).toBe("SN-2026-000301");
  });

  /*
    Unassessed above settled: a serious case nobody has looked at could turn
    out to be expedited, and Day 0 was whenever it arrived.
  */
  it("ranks an unassessed serious case above a settled one", () => {
    const seriousUnassessed = row({ reference: "SN-2026-000500", serious: true });
    expect(clockRank(seriousUnassessed)).toBeLessThan(clockRank(settled));
  });

  it("sorts received newest first", () => {
    const older = row({ reference: "SN-A" });
    const newer = row({ reference: "SN-B" });
    // Overriding `record` wholesale would also overwrite the reference the
    // helper just set, so only the field under test is changed.
    (newer.record as { receivedAt: string }).receivedAt = "2026-08-20";
    expect(
      sortRows([older, newer], "received").map((r) => r.record.reference),
    ).toEqual(["SN-B", "SN-A"]);
  });

  /*
    A queue whose rows shuffle between renders is one nobody can keep their
    place in — and the keyboard cursor would land somewhere different each
    time the page revalidated.
  */
  it("is deterministic: equal rows break the tie on reference", () => {
    const a = row({ reference: "SN-B" });
    const b = row({ reference: "SN-A" });
    expect(sortRows([a, b], "clock").map((r) => r.record.reference)).toEqual([
      "SN-A",
      "SN-B",
    ]);
    expect(sortRows([b, a], "clock").map((r) => r.record.reference)).toEqual([
      "SN-A",
      "SN-B",
    ]);
  });

  it("does not mutate its input", () => {
    const original = [...ALL];
    sortRows(ALL, "drug");
    expect(ALL).toEqual(original);
  });

  it("falls back to the clock for an unknown sort name", () => {
    expect(parseSort("nonsense")).toBe("clock");
    expect(parseSort(undefined)).toBe("clock");
    expect(parseSort("received")).toBe("received");
  });
});

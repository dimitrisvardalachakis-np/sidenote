/**
 * The seeded queue is data, but it is data the two screens are designed
 * around, so it gets the same treatment as code. These tests assert the
 * spread the brief asked for actually exists — a fixture set that quietly
 * drifts into "all twelve cases look the same" would make the screens look
 * finished while proving nothing.
 */
import { describe, expect, it } from "vitest";
import {
  SERIOUSNESS_CRITERIA,
  caseValidity,
  expeditedClock,
  isSerious,
  sourcesDisagree,
  spanMatchesNarrative,
  standingListedness,
} from "@/lib/schemas";
import { buildSeedCases, findSeedCase } from "./seed";

const TODAY = "2026-08-24";
const cases = buildSeedCases(TODAY);

const clockFor = (index: number) => {
  const seeded = cases[index];
  if (seeded === undefined) throw new Error("missing fixture");
  return expeditedClock(
    seeded.record,
    standingListedness(seeded.assessment) === "unlisted",
    TODAY,
  );
};

describe("the seeded queue", () => {
  it("has twelve cases", () => {
    expect(cases).toHaveLength(12);
  });

  it("gives every case a distinct reference and id", () => {
    expect(new Set(cases.map((c) => c.record.reference)).size).toBe(12);
    expect(new Set(cases.map((c) => c.record.id)).size).toBe(12);
  });

  it("is deterministic for a given date", () => {
    expect(JSON.stringify(buildSeedCases(TODAY))).toBe(
      JSON.stringify(buildSeedCases(TODAY)),
    );
  });

  it("moves with the date rather than pinning to one", () => {
    const later = buildSeedCases("2026-09-01");
    expect(later[0]?.record.receivedAt).not.toBe(cases[0]?.record.receivedAt);
  });
});

describe("clock states", () => {
  const states = cases.map((_, i) => clockFor(i).state);

  it("covers all three states", () => {
    expect(new Set(states)).toEqual(
      new Set(["overdue", "running", "not_applicable"]),
    );
  });

  it("has at least one overdue case", () => {
    expect(states.filter((s) => s === "overdue").length).toBeGreaterThanOrEqual(1);
  });

  it("includes a case due today, still running at zero", () => {
    const dueToday = cases
      .map((_, i) => clockFor(i))
      .find((c) => c.state === "running" && c.daysRemaining === 0);
    expect(dueToday).toBeDefined();
  });

  it("never starts a clock on a listed reaction", () => {
    for (const [index, seeded] of cases.entries()) {
      if (standingListedness(seeded.assessment) === "listed") {
        expect(clockFor(index).state).toBe("not_applicable");
      }
    }
  });

  it("never starts a clock when the company source could not be read", () => {
    // An outage is not evidence of absence. SN-2026-000107 exists to prove
    // that a source_unavailable listedness cannot begin a 15-day obligation.
    const unavailable = cases.findIndex(
      (c) => c.assessment.listedness.state === "source_unavailable",
    );
    expect(unavailable).toBeGreaterThanOrEqual(0);
    expect(clockFor(unavailable).state).toBe("not_applicable");
  });

  it("never starts a clock on a case with no serious flag", () => {
    for (const [index, seeded] of cases.entries()) {
      const anySerious = seeded.record.reactions.some((r) =>
        isSerious(r.seriousness),
      );
      if (!anySerious) expect(clockFor(index).state).toBe("not_applicable");
    }
  });
});

describe("the two disagreements", () => {
  const disagreeing = cases.filter((c) => sourcesDisagree(c.assessment));

  it("has exactly two", () => {
    expect(disagreeing).toHaveLength(2);
  });

  it("covers both directions", () => {
    const directions = disagreeing.map((c) => {
      const l = c.assessment.listedness;
      return l.state === "grounded" ? l.determination : "?";
    });
    expect(new Set(directions)).toEqual(new Set(["listed", "unlisted"]));
  });
});

describe("panel states", () => {
  it("exercises grounded, no_result and source_unavailable on the company side", () => {
    const states = new Set(cases.map((c) => c.assessment.listedness.state));
    expect(states).toEqual(
      new Set(["grounded", "no_result", "source_unavailable"]),
    );
  });

  it("exercises all three on the public side too", () => {
    const states = new Set(cases.map((c) => c.assessment.expectedness.state));
    expect(states).toEqual(
      new Set(["grounded", "no_result", "source_unavailable"]),
    );
  });

  it("never cites across the company/public boundary", () => {
    for (const { assessment } of cases) {
      if (assessment.listedness.state === "grounded") {
        for (const citation of assessment.listedness.citations) {
          expect(citation.sourceType).toBe("company");
        }
      }
      if (assessment.expectedness.state === "grounded") {
        for (const citation of assessment.expectedness.citations) {
          expect(citation.sourceType).toBe("public");
        }
      }
    }
  });
});

describe("seriousness evidence", () => {
  it("has every narrative-derived flag pointing at real text", () => {
    let checked = 0;
    for (const { record } of cases) {
      for (const reaction of record.reactions) {
        for (const criterion of SERIOUSNESS_CRITERIA) {
          const flag = reaction.seriousness[criterion];
          if (flag === null || flag.basis !== "narrative") continue;
          if (flag.trigger === null) throw new Error("narrative flag with no span");
          expect(spanMatchesNarrative(record.narrative, flag.trigger)).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("includes a flag the reporter merely declared, with no phrase", () => {
    const declared = cases.find(({ record }) =>
      record.reactions.some((r) =>
        SERIOUSNESS_CRITERIA.some((c) => r.seriousness[c]?.basis === "declared"),
      ),
    );
    expect(declared).toBeDefined();
    expect(declared?.record.origin).toBe("public_form");
  });
});

describe("validity", () => {
  it("includes an incomplete case, so the checklist has something to say", () => {
    const incomplete = cases.filter((c) => !caseValidity(c.record).isValid);
    expect(incomplete.length).toBeGreaterThanOrEqual(1);
    expect(caseValidity(incomplete[0]!.record).missing).toContain("reporter");
  });

  it("has most cases valid", () => {
    const valid = cases.filter((c) => caseValidity(c.record).isValid);
    expect(valid.length).toBeGreaterThanOrEqual(10);
  });
});

describe("findSeedCase", () => {
  it("finds a case by id", () => {
    const first = cases[0];
    if (first === undefined) throw new Error("no fixtures");
    expect(findSeedCase(TODAY, first.record.id)?.record.reference).toBe(
      first.record.reference,
    );
  });

  it("returns null for an unknown id", () => {
    expect(findSeedCase(TODAY, "not-a-case")).toBeNull();
  });
});

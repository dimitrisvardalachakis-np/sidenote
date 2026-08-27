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
  ruledListedness,
  sourcesDisagree,
  spanMatchesNarrative,
  type ExpectednessFinding,
  type ListednessFinding,
} from "@/lib/schemas";
import { buildSeedCases, findSeedCase } from "./seed";

const TODAY = "2026-08-24";
const cases = buildSeedCases(TODAY);

const clockFor = (index: number) => {
  const seeded = cases[index];
  if (seeded === undefined) throw new Error("missing fixture");
  return expeditedClock(
    seeded.record,
    ruledListedness(seeded.assessment) === "unlisted",
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
      if (ruledListedness(seeded.assessment) === "listed") {
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
    // The determination now lives on the ruling and nowhere else, so this
    // reads it from the reviewer's decision rather than from the finding.
    const directions = disagreeing.map(
      (c) => c.assessment.ruling?.listedness ?? "?",
    );
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

describe("the fixture timeline is coherent", () => {
  /**
   * Evidence is gathered before it is ruled on. The retrieval stamp used to be
   * a pinned instant while every other timestamp moved with `today`, so a
   * reviewer could be recorded ruling on evidence that would not be retrieved
   * for another three weeks.
   */
  const stampOf = (f: ListednessFinding | ExpectednessFinding): string =>
    f.state === "source_unavailable" ? f.attemptedAt : f.retrievedAt;

  it("retrieves after the case is created and before any ruling", () => {
    for (const seeded of cases) {
      const created = seeded.record.createdAt;
      for (const finding of [
        seeded.assessment.listedness,
        seeded.assessment.expectedness,
      ]) {
        const at = stampOf(finding);
        expect(at >= created).toBe(true);
        const ruling = seeded.assessment.ruling;
        if (ruling !== null) expect(at <= ruling.decidedAt).toBe(true);
      }
    }
  });

  it("keeps the retrieval stamp on the same day the case arrived", () => {
    for (const seeded of cases) {
      expect(stampOf(seeded.assessment.listedness).slice(0, 10)).toBe(
        seeded.record.receivedAt,
      );
    }
  });

  it("gives every case somebody has opened a named reviewer", () => {
    // "in_review" means a reviewer is holding it. A null assignee contradicts
    // the status, and one case said both.
    for (const seeded of cases) {
      if (seeded.record.status !== "received") {
        expect(seeded.record.assignedTo).not.toBeNull();
      }
    }
  });

  it("only rules on cases a reviewer has actually worked", () => {
    for (const seeded of cases) {
      if (seeded.assessment.ruling !== null) {
        expect(["assessed", "reported", "closed"]).toContain(
          seeded.record.status,
        );
      }
    }
  });
});

describe("the reading's own timestamp moves with the case", () => {
  it("stamps the nested reading, not only the finding around it", () => {
    // stampFinding did a shallow copy, so the reading kept the pinned
    // constant — reintroducing one level down the exact defect the function
    // was written to fix.
    for (const seeded of cases) {
      for (const finding of [
        seeded.assessment.listedness,
        seeded.assessment.expectedness,
      ]) {
        if (finding.state !== "grounded") continue;
        const stamp =
          finding.reading.status === "unavailable"
            ? finding.reading.attemptedAt
            : finding.reading.generatedAt;
        expect(stamp.slice(0, 10)).toBe(seeded.record.receivedAt);
      }
    }
  });
});

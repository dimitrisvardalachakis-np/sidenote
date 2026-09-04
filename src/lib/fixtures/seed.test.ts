/**
 * The seeded queue is data, but it is data the two screens are designed
 * around, so it gets the same treatment as code.
 *
 * THESE TESTS USED TO ASSERT A SPREAD, and most of them no longer can. The
 * fixture set was twelve cases chosen to exercise every state the screens can
 * render — a listed reaction with no clock, an outage on the company side, an
 * incomplete case, a flag the reporter merely ticked — and it is now three,
 * because the queue became a demo script. Every assertion that counted twelve,
 * or demanded all three panel states, or looked for the one incomplete case,
 * was deleted rather than loosened: a test rewritten from `toBe(12)` to
 * `toBeGreaterThan(0)` still reads like a guarantee and guarantees nothing.
 *
 * The behaviours they covered are tested directly and still are —
 * `expeditedClock`, `caseValidity` and `spanMatchesNarrative` in
 * `schemas/schemas.test.ts`, the three panel states in
 * `components/evidence.test.tsx`. What is genuinely gone is the guarantee that
 * the SEEDED QUEUE exercises them. If the fixture set grows back, the spread
 * assertions are worth restoring with it; the git history has them.
 *
 * What remains below is everything that is still true of three cases, and it
 * is not nothing: determinism, the coherence of the timeline, the
 * company/public citation boundary, and the two clock states the demo turns
 * on.
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
  it("has three cases", () => {
    expect(cases).toHaveLength(3);
  });

  it("gives every case a distinct reference and id", () => {
    expect(new Set(cases.map((c) => c.record.reference)).size).toBe(3);
    expect(new Set(cases.map((c) => c.record.id)).size).toBe(3);
  });

  /*
    The three the demo opens on, by name. A fixture silently disappearing is
    the failure this catches — the queue would simply be shorter, and nothing
    else in the suite would notice.
  */
  it("is the three the demo script names", () => {
    expect(cases.map((c) => c.record.reference)).toEqual([
      "SN-2026-000101",
      "SN-2026-000102",
      "SN-2026-000105",
    ]);
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

  /*
    Two states, not three. `not_applicable` left with the nine cases that
    demonstrated it; `expeditedClock` still has its own tests for all three.
  */
  it("covers the overdue case and the running one", () => {
    expect(new Set(states)).toEqual(new Set(["overdue", "running"]));
  });

  it("has at least one overdue case", () => {
    expect(states.filter((s) => s === "overdue").length).toBeGreaterThanOrEqual(1);
  });

  it("never starts a clock on a listed reaction", () => {
    for (const [index, seeded] of cases.entries()) {
      if (ruledListedness(seeded.assessment) === "listed") {
        expect(clockFor(index).state).toBe("not_applicable");
      }
    }
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

describe("the disagreement", () => {
  const disagreeing = cases.filter((c) => sourcesDisagree(c.assessment));

  /*
    One, where there were two. The pair used to run in both directions —
    Dermacil with the CCDS ahead of the label, Pulmoxa with the label ahead of
    the CCDS — and only the second survives here. The other direction is still
    in the corpus (`documents.test.ts` pins it) and is reachable by assessing
    a Hepalex case for real; it is no longer pre-baked into a fixture.
  */
  it("has one, and the label is the source that is ahead", () => {
    expect(disagreeing).toHaveLength(1);
    // The determination lives on the ruling and nowhere else, so this reads
    // the reviewer's decision rather than the finding.
    expect(disagreeing[0]?.assessment.ruling?.listedness).toBe("unlisted");
    expect(disagreeing[0]?.assessment.ruling?.expectedness).toBe("expected");
  });
});

describe("panel states", () => {
  /*
    All three cases are grounded on both sides now. `no_result` and
    `source_unavailable` are no longer represented in the fixture at all —
    they are reached by assessing for real against a corpus that does not
    cover a drug, and rendered under test in `components/evidence.test.tsx`.
  */
  it("is grounded on both sides of every case", () => {
    for (const { assessment } of cases) {
      expect(assessment.listedness.state).toBe("grounded");
      expect(assessment.expectedness.state).toBe("grounded");
    }
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
    // Five spans across three cases: three on 101, one on 102, one on 105.
    expect(checked).toBe(5);
  });

  /*
    Every surviving flag was raised from the narrative with a phrase to point
    at. The `declared` basis — a criterion the reporter simply ticked, with no
    span — left with SN-2026-000111, and this asserts the absence rather than
    leaving a reader to assume the coverage is still there. The rendering of a
    declared flag is exercised by the public intake's own tests.
  */
  it("no longer carries a flag the reporter merely declared", () => {
    const declared = cases.find(({ record }) =>
      record.reactions.some((r) =>
        SERIOUSNESS_CRITERIA.some((c) => r.seriousness[c]?.basis === "declared"),
      ),
    );
    expect(declared).toBeUndefined();
  });
});

describe("validity", () => {
  /*
    All three are complete. The incomplete case that gave the validity
    checklist something to say went with SN-2026-000109; `caseValidity` is
    tested directly against every missing-element combination in
    `schemas/schemas.test.ts`.
  */
  it("has every case valid on all four elements", () => {
    for (const { record } of cases) {
      expect(caseValidity(record).isValid).toBe(true);
    }
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

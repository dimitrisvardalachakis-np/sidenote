/**
 * The narrative's shape, and the absences that carry the honesty rules.
 *
 * The tests worth reading twice are the last two in each block: `strictObject`
 * biting on an extra field, and a pre-feature stored assessment still parsing.
 * The first is what makes "there is no field in which a determination could be
 * recorded" a checkable claim rather than a comment; the second is what stops
 * this feature quietly deleting assessments that were written before it.
 */
import { describe, expect, it } from "vitest";
import {
  Assessment,
  GroundedNarrative,
  ListednessFinding,
  NARRATIVE_MAX_POINTS,
  NARRATIVE_POINT_MAX_CHARS,
  NarrativePoint,
} from "./index";

const POINT = {
  chunkId: "ccds#1",
  quotedSpan: "Jaundice has been reported rarely.",
  sentence: "The passage records jaundice as an uncommon occurrence.",
};

const narrative = (points: unknown[]) => ({
  status: "narrated",
  points,
  model: "test-model",
  gatewayRequestId: null,
  generatedAt: "2026-08-26T10:00:00Z",
});

describe("NarrativePoint", () => {
  it("accepts a well-formed point", () => {
    expect(NarrativePoint.safeParse(POINT).success).toBe(true);
  });

  it.each(["should", "recommended", "expedited"])(
    "rejects a sentence containing %s",
    (word) => {
      const result = NarrativePoint.safeParse({
        ...POINT,
        sentence: `The passage says this ${word} be noted.`,
      });
      expect(result.success).toBe(false);
    },
  );

  it.each(["listed", "unlisted", "serious", "unexpected"])(
    "rejects a sentence containing the determination word %s",
    (word) => {
      const result = NarrativePoint.safeParse({
        ...POINT,
        sentence: `The reaction is ${word} here.`,
      });
      expect(result.success).toBe(false);
    },
  );

  /*
    The other half of that rule, and the one that keeps non-negotiable #6
    pointing the right way. A safety document contains these words; the gate is
    on what the MODEL wrote, never on what the document said.
  */
  it.each(["listed", "serious", "expected"])(
    "accepts a quoted span containing %s",
    (word) => {
      const result = NarrativePoint.safeParse({
        ...POINT,
        quotedSpan: `Reactions were ${word} in the table above.`,
      });
      expect(result.success).toBe(true);
    },
  );

  it("rejects a multi-sentence point", () => {
    expect(
      NarrativePoint.safeParse({
        ...POINT,
        sentence: "The passage says one thing. It also says another.",
      }).success,
    ).toBe(false);
  });

  it("rejects a sentence over the cap", () => {
    expect(
      NarrativePoint.safeParse({
        ...POINT,
        sentence: `A ${"x".repeat(NARRATIVE_POINT_MAX_CHARS)}.`,
      }).success,
    ).toBe(false);
  });

  it("rejects an empty quoted span", () => {
    expect(NarrativePoint.safeParse({ ...POINT, quotedSpan: "" }).success).toBe(false);
  });

  /*
    `strictObject`, not `object`. Zod strips unknown keys by default, which
    would mean a `determination` field was silently discarded rather than
    refused — and "there is no field in which a determination could be
    recorded" would be true only by accident of what nobody happened to send.
  */
  it("refuses an extra field rather than silently dropping it", () => {
    const result = NarrativePoint.safeParse({ ...POINT, determination: "listed" });
    expect(result.success).toBe(false);
  });
});

describe("GroundedNarrative", () => {
  it("rejects a narrated narrative with no points", () => {
    expect(GroundedNarrative.safeParse(narrative([])).success).toBe(false);
  });

  it(`rejects more than ${NARRATIVE_MAX_POINTS} points`, () => {
    const tooMany = Array.from({ length: NARRATIVE_MAX_POINTS + 1 }, (_, i) => ({
      ...POINT,
      chunkId: `ccds#${i}`,
    }));
    expect(GroundedNarrative.safeParse(narrative(tooMany)).success).toBe(false);
  });

  it("accepts the unavailable state with a reason", () => {
    const result = GroundedNarrative.safeParse({
      status: "unavailable",
      reason: "no model is configured",
      model: null,
      gatewayRequestId: null,
      attemptedAt: "2026-08-26T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("has no state between narrated and unavailable", () => {
    expect(
      GroundedNarrative.options.map((o) => o.shape.status.value).sort(),
    ).toEqual(["narrated", "unavailable"]);
  });

  it("has no top-level field for an uncited sentence", () => {
    const withSummary = { ...narrative([POINT]), summary: "Everything is fine." };
    // A summary would be stripped rather than stored, so the parsed value
    // cannot carry one. There is nowhere to put a sentence without a citation.
    const result = GroundedNarrative.safeParse(withSummary);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("summary");
  });
});

describe("stored records written before this feature", () => {
  const groundedFinding = {
    state: "grounded",
    documentKind: "ccds",
    citations: [
      {
        chunkId: "ccds#1",
        documentId: "00000001-0000-4000-8000-000000000001",
        sourceType: "company",
        section: "4.8",
        quote: "Jaundice has been reported rarely.",
      },
    ],
    reading: {
      status: "read",
      chunkId: "ccds#1",
      quotedSpan: "Jaundice has been reported rarely.",
      rationale: null,
      model: "m",
      gatewayRequestId: null,
      generatedAt: "2026-08-26T10:00:00Z",
    },
    retrievedAt: "2026-08-26T10:00:00Z",
  };

  /*
    `LocalFileAssessmentStore.get` runs `Assessment.safeParse` over stored JSON
    and returns null on failure, and the case screen renders null as "Not
    assessed yet". A required `narrative` key would therefore have made every
    assessment written before today silently vanish from the screen. The
    default is what stops that, and this is the test that would have caught it.
  */
  it("parses a grounded finding with no narrative key, defaulting to null", () => {
    const result = ListednessFinding.safeParse(groundedFinding);
    expect(result.success).toBe(true);
    if (!result.success) return;
    if (result.data.state !== "grounded") return;
    expect(result.data.narrative).toBeNull();
  });

  it("parses a whole stored Assessment with no narrative anywhere", () => {
    const result = Assessment.safeParse({
      id: "00000003-0000-4000-8000-000000000001",
      caseId: "00000002-0000-4000-8000-000000000101",
      reactionId: "00000004-0000-4000-8000-000000000001",
      drugId: "00000005-0000-4000-8000-000000000001",
      listedness: groundedFinding,
      expectedness: {
        state: "no_result",
        query: "liver failure",
        retrievedAt: "2026-08-26T10:00:00Z",
      },
      ruling: null,
      createdAt: "2026-08-26T10:00:00Z",
      updatedAt: "2026-08-26T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

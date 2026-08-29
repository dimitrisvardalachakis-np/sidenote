import { describe, expect, it } from "vitest";
import { DocumentId, type SafetyDocument } from "@/lib/schemas";
import {
  affectedCaseCount,
  coverageBySubstance,
  coverageFor,
  isUncovered,
} from "./coverage";

let n = 0;
function doc(over: Partial<SafetyDocument>): SafetyDocument {
  n += 1;
  return {
    id: DocumentId.parse(
      `0000000${n}-0000-4000-8000-00000000000${n}`.slice(0, 36),
    ),
    title: "A document",
    kind: "ccds",
    sourceType: "company",
    activeSubstance: "hepalexin",
    version: "7.2",
    effectiveDate: "2026-01-15",
    objectKey: null,
    status: "embedded",
    rejectionReason: null,
    chunkCount: 5,
    uploadedAt: "2026-08-01T09:00:00Z",
    uploadedBy: null,
    ...over,
  } as SafetyDocument;
}

const HEPALEX_CCDS = doc({ title: "Hepalex CCDS", activeSubstance: "hepalexin" });
const HEPALEX_LABEL = doc({
  title: "Hepalex — FDA Prescribing Information",
  kind: "fda_label",
  sourceType: "public",
  activeSubstance: "hepalexin",
});
const PULMOXA_LABEL = doc({
  title: "Pulmoxa — FDA Prescribing Information",
  kind: "fda_label",
  sourceType: "public",
  activeSubstance: "pulmoxacin",
});

const LIBRARY = [HEPALEX_CCDS, HEPALEX_LABEL, PULMOXA_LABEL];

describe("coverage for one medicine", () => {
  it("reports both halves when both are held", () => {
    const out = coverageFor(LIBRARY, {
      reportedName: "Hepalex",
      activeSubstance: "hepalexin",
    });
    expect(out.company).toHaveLength(1);
    expect(out.publicLabel).toHaveLength(1);
    expect(isUncovered(out)).toBe(false);
  });

  /*
    THE case this exists for. A case for a drug with no company document looked
    exactly like a case for a drug with one, right up until the search returned
    nothing — and "no matching passage" then reads as a fact about the document
    rather than about the shelf.
  */
  it("reports the gap when only the public label is held", () => {
    const out = coverageFor(LIBRARY, {
      reportedName: "Pulmoxa",
      activeSubstance: "pulmoxacin",
    });
    expect(out.company).toHaveLength(0);
    expect(out.publicLabel).toHaveLength(1);
    expect(isUncovered(out)).toBe(false);
  });

  it("reports nothing held for a medicine the library has never seen", () => {
    const out = coverageFor(LIBRARY, {
      reportedName: "Dermacil",
      activeSubstance: "dermacilin",
    });
    expect(isUncovered(out)).toBe(true);
  });

  it("does not report another product's document as coverage", () => {
    const out = coverageFor(LIBRARY, {
      reportedName: "Pulmoxa",
      activeSubstance: "pulmoxacin",
    });
    expect(out.publicLabel[0]?.activeSubstance).toBe("pulmoxacin");
    expect(out.company).toHaveLength(0);
  });
});

describe("coverage across the library", () => {
  it("lists one row per active substance, sorted", () => {
    const rows = coverageBySubstance(LIBRARY);
    expect(rows.map((r) => r.drug.activeSubstance)).toEqual([
      "hepalexin",
      "pulmoxacin",
    ]);
  });

  /*
    Grouped on the substance, not the brand: two brands of one molecule share a
    CCDS, and listing them separately would report a gap that is not there.
  */
  it("does not double-count two documents for one substance", () => {
    const rows = coverageBySubstance(LIBRARY);
    const hepalexin = rows.find((r) => r.drug.activeSubstance === "hepalexin");
    expect(hepalexin?.company).toHaveLength(1);
    expect(hepalexin?.publicLabel).toHaveLength(1);
  });

  it("is empty for an empty library", () => {
    expect(coverageBySubstance([])).toEqual([]);
  });
});

describe("what an upload affects", () => {
  const cases = [
    { drugs: [{ reportedName: "Hepalex", activeSubstance: "hepalexin" }] },
    { drugs: [{ reportedName: "Hepalex", activeSubstance: "hepalexin" }] },
    { drugs: [{ reportedName: "Pulmoxa", activeSubstance: "pulmoxacin" }] },
  ];

  it("counts the cases a new document reaches", () => {
    expect(affectedCaseCount(cases, HEPALEX_CCDS)).toBe(2);
  });

  it("counts none when the document governs nothing in the queue", () => {
    const unrelated = doc({ activeSubstance: "somethingelse" });
    expect(affectedCaseCount(cases, unrelated)).toBe(0);
  });

  it("counts a case once even if it lists the drug twice", () => {
    const duplicated = [
      {
        drugs: [
          { reportedName: "Hepalex", activeSubstance: "hepalexin" },
          { reportedName: "Hepalex 500", activeSubstance: "hepalexin" },
        ],
      },
    ];
    expect(affectedCaseCount(duplicated, HEPALEX_CCDS)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { lookupCaseReference } from "./reference";

const KNOWN = [
  { id: "id-101", reference: "SN-2026-000101" },
  { id: "id-104", reference: "SN-2026-000104" },
  { id: "id-old", reference: "SN-2025-000104" },
  { id: "id-412", reference: "SN-2026-000412" },
] as const;

describe("lookupCaseReference", () => {
  it("resolves a full reference", () => {
    expect(lookupCaseReference("SN-2026-000104", KNOWN)).toEqual({
      kind: "found",
      caseId: "id-104",
    });
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(lookupCaseReference("  sn-2026-000101  ", KNOWN)).toEqual({
      kind: "found",
      caseId: "id-101",
    });
  });

  it("resolves an ordinal a person would say out loud", () => {
    expect(lookupCaseReference("412", KNOWN)).toEqual({
      kind: "found",
      caseId: "id-412",
    });
  });

  it("ignores zero padding on an ordinal", () => {
    expect(lookupCaseReference("000412", KNOWN)).toEqual({
      kind: "found",
      caseId: "id-412",
    });
  });

  /*
    The reason this function exists rather than a regex at the call site.
    Two years share ordinal 104; sending the reviewer to either one would be
    a guess, and they would have no way to know a guess had been made.
  */
  it("refuses an ambiguous ordinal rather than picking one", () => {
    const result = lookupCaseReference("104", KNOWN);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect([...result.matches].sort()).toEqual([
      "SN-2025-000104",
      "SN-2026-000104",
    ]);
  });

  it("prefers an exact reference over an ambiguous ordinal", () => {
    expect(lookupCaseReference("SN-2025-000104", KNOWN)).toEqual({
      kind: "found",
      caseId: "id-old",
    });
  });

  it("resolves an unambiguous prefix", () => {
    expect(lookupCaseReference("SN-2026-0001", KNOWN).kind).toBe("ambiguous");
    expect(lookupCaseReference("SN-2025", KNOWN)).toEqual({
      kind: "found",
      caseId: "id-old",
    });
  });

  it("reports nothing found for an unknown reference", () => {
    expect(lookupCaseReference("SN-2026-999999", KNOWN)).toEqual({
      kind: "not_found",
    });
  });

  it("treats empty input as nothing found rather than matching everything", () => {
    expect(lookupCaseReference("   ", KNOWN)).toEqual({ kind: "not_found" });
    expect(lookupCaseReference("", KNOWN)).toEqual({ kind: "not_found" });
  });
});

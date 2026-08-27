/**
 * Scoping is a filter, not a ranking signal. A wrong-product citation is not a
 * worse hit — it is a different document, and quoting one drug's confidential
 * CCDS as another drug's evidence is the failure this file exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { DrugId, type SuspectDrug } from "@/lib/schemas";
import { documentGovernsDrug, documentsForDrug } from "./scope";

const drug = (reportedName: string, activeSubstance: string | null): SuspectDrug => ({
  id: DrugId.parse("00000002-0000-4000-8000-000000000001"),
  reportedName,
  activeSubstance,
  role: "suspect",
  marketingStatus: "marketed",
  dose: null,
  route: null,
  indication: null,
  therapyStart: null,
  therapyEnd: null,
  dechallenge: null,
  rechallenge: null,
});

describe("matching a case to its documents", () => {
  it("matches on the substance when the case records one", () => {
    const ids = documentsForDrug(SEED_DOCUMENTS, drug("Hepalex", "hepalexin"));
    expect(ids.size).toBe(2); // the CCDS and the FDA label
    for (const doc of SEED_DOCUMENTS) {
      expect(ids.has(doc.id)).toBe(doc.activeSubstance === "hepalexin");
    }
  });

  it("never matches a different product on a shared symptom", () => {
    const ids = documentsForDrug(SEED_DOCUMENTS, drug("Covaxil", "covaxilin"));
    const hepalex = SEED_DOCUMENTS.filter((d) => d.activeSubstance === "hepalexin");
    for (const doc of hepalex) expect(ids.has(doc.id)).toBe(false);
  });

  it("falls back to the brand name when a public reporter knows only the box", () => {
    // A member of the public cannot know the substance; the case carries null.
    const ids = documentsForDrug(SEED_DOCUMENTS, drug("Hepalex", null));
    expect(ids.size).toBe(2);
  });

  it("matches a brand that is the stem of its substance", () => {
    const hepalexCcds = SEED_DOCUMENTS.find((d) => d.activeSubstance === "hepalexin");
    expect(hepalexCcds).toBeDefined();
    if (hepalexCcds !== undefined) {
      expect(documentGovernsDrug(hepalexCcds, drug("Hepalex", null))).toBe(true);
      expect(documentGovernsDrug(hepalexCcds, drug("Covaxil", null))).toBe(false);
    }
  });

  it("returns nothing rather than guessing for an unknown product", () => {
    expect(documentsForDrug(SEED_DOCUMENTS, drug("Unknownium", "unobtainium")).size).toBe(0);
  });

  it("refuses to match on a name too short to be distinctive", () => {
    const doc = SEED_DOCUMENTS[0];
    expect(doc).toBeDefined();
    if (doc !== undefined) expect(documentGovernsDrug(doc, drug("XY", null))).toBe(false);
  });
});

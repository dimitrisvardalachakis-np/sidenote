/**
 * Scoping is a filter, not a ranking signal. A wrong-product citation is not a
 * worse hit — it is a different document, and quoting one drug's confidential
 * CCDS as another drug's evidence is the failure this file exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { DrugId, type SuspectDrug } from "@/lib/schemas";
import { SafetyDocument } from "@/lib/schemas";
import { activeMoiety, documentGovernsDrug, documentsForDrug } from "./scope";

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

/**
 * The salt form, which is how FDA files a label and not how anyone says it.
 *
 * This is the bug a reporter hit on the public search: they typed "ABACAVIR
 * SULFATE" — the wording openFDA itself returns — the label was fetched,
 * chunked into 24 passages, mirrored, and then excluded from the search it had
 * just been fetched for, because the document was stored under "abacavir".
 * They were shown "Nothing found" and, underneath it, a sentence saying no
 * published label describes that. The label described it.
 */
describe("the salt a label is filed under is not a different medicine", () => {
  const label = (activeSubstance: string, title: string): SafetyDocument =>
    SafetyDocument.parse({
      id: "01e46f58-8bda-4ff3-ab21-57d5b540d440",
      title,
      kind: "fda_label",
      sourceType: "public",
      activeSubstance,
      version: null,
      effectiveDate: null,
      objectKey: null,
      status: "embedded",
      rejectionReason: null,
      chunkCount: 24,
      uploadedAt: "2026-08-28T00:00:00.000Z",
    });

  const abacavir = label("abacavir", "Abacavir — FDA Prescribing Information");

  it("matches the name the reporter typed to the label as stored", () => {
    expect(documentGovernsDrug(abacavir, drug("ABACAVIR SULFATE", null))).toBe(true);
  });

  it("matches in the other direction too, so storage order cannot decide it", () => {
    const filedUnderSalt = label(
      "abacavir sulfate",
      "Abacavir Sulfate — FDA Prescribing Information",
    );
    expect(documentGovernsDrug(filedUnderSalt, drug("abacavir", null))).toBe(true);
  });

  it("matches on the reviewer path, where the case carries a substance", () => {
    // A triaged case recording "abacavir sulfate" and a label held under
    // "abacavir" are one medicine; before this the assessment fetched the
    // label and then reported expectedness as source_unavailable.
    expect(
      documentGovernsDrug(abacavir, drug("Ziagen", "abacavir sulfate")),
    ).toBe(true);
  });

  it("still refuses a combination product, which is a different medicine", () => {
    // "clavulanate" is not on the salt list, and the list is closed precisely
    // so that co-amoxiclav cannot inherit amoxicillin's label.
    const amoxicillin = label(
      "amoxicillin",
      "Amoxicillin — FDA Prescribing Information",
    );
    expect(
      documentGovernsDrug(amoxicillin, drug("amoxicillin clavulanate", null)),
    ).toBe(false);
    expect(
      documentGovernsDrug(amoxicillin, drug("Augmentin", "amoxicillin clavulanate")),
    ).toBe(false);
  });

  it("still refuses an unrelated product that happens to share a salt", () => {
    const abacavirSalt = label(
      "abacavir sulfate",
      "Abacavir Sulfate — FDA Prescribing Information",
    );
    expect(
      documentGovernsDrug(abacavirSalt, drug("morphine sulfate", null)),
    ).toBe(false);
  });

  it("reduces a name to its moiety, and never to nothing", () => {
    expect(activeMoiety("ABACAVIR SULFATE")).toBe("abacavir");
    expect(activeMoiety("Atorvastatin Calcium Trihydrate")).toBe("atorvastatin");
    expect(activeMoiety("hepalexin")).toBe("hepalexin");
    // A name that is nothing but a salt word keeps it; stripping to the empty
    // string would make one document match every drug.
    expect(activeMoiety("sodium")).toBe("sodium");
  });

  it("reaches a multi-word brand through the title, which it could not before", () => {
    // The title test compared the typed name against the title's individual
    // words, so a two-word brand could never match one of them — and a brand
    // is the only name a member of the public reliably has.
    const branded = label("albuterol", "Ventolin HFA — FDA Prescribing Information");
    expect(documentGovernsDrug(branded, drug("Ventolin HFA", null))).toBe(true);
    // Still whole words: a brand is not matched by a fragment of one.
    expect(documentGovernsDrug(branded, drug("Vento", null))).toBe(false);
  });
});

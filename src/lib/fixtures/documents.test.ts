/**
 * The corpus has to cover the queue.
 *
 * For a long while it did not. `documents.ts` held four documents — a label
 * and a CCDS for each of two products — while `seed.ts` shipped cases for four
 * more drugs, each carrying a hand-written assessment quoting passages that
 * existed nowhere. Nothing failed: the fixture assessments rendered, the
 * badges looked confident, and the gap only appeared when somebody pressed
 * Re-assess and the evidence beneath a "Sources disagree" headline collapsed
 * to "Source unavailable".
 *
 * These tests are the thing that was missing. They tie the two fixture files
 * together through `documentGovernsDrug` — the same predicate retrieval and
 * the library coverage screen use — so a case whose drug has no document
 * cannot be added without failing the build. They also pin the two divergences
 * the demo exists to show, because a corpus where every source agrees would
 * satisfy the coverage check above and demonstrate nothing.
 */
import { describe, expect, it } from "vitest";
import { documentGovernsDrug } from "@/lib/assess/scope";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "./documents";
import { buildSeedCases } from "./seed";

const TODAY = "2026-08-24";

/** Every chunk of one document, joined — what a search over it can reach. */
function textOf(title: string): string {
  const document = SEED_DOCUMENTS.find((d) => d.title === title);
  if (document === undefined) throw new Error(`no fixture document: ${title}`);
  return SEED_CHUNKS.filter((c) => c.documentId === document.id)
    .map((c) => c.text)
    .join("\n");
}

describe("the seeded corpus covers the seeded queue", () => {
  it("holds a company document for every drug in every seeded case", () => {
    for (const seeded of buildSeedCases(TODAY)) {
      for (const drug of seeded.record.drugs) {
        const governing = SEED_DOCUMENTS.filter(
          (doc) =>
            doc.sourceType === "company" && documentGovernsDrug(doc, drug),
        );
        expect(
          governing.length,
          `${seeded.record.reference}: no company document for ${drug.reportedName}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  /*
    Marketed only. An investigational product has no FDA label, and asserting
    one existed would be asserting the opposite of what NRV-114 is here to
    show — the public panel says no document is held BECAUSE there is none.
  */
  it("holds a public label for every marketed drug in every seeded case", () => {
    for (const seeded of buildSeedCases(TODAY)) {
      for (const drug of seeded.record.drugs) {
        if (drug.marketingStatus !== "marketed") continue;
        const governing = SEED_DOCUMENTS.filter(
          (doc) => doc.sourceType === "public" && documentGovernsDrug(doc, drug),
        );
        expect(
          governing.length,
          `${seeded.record.reference}: no public label for ${drug.reportedName}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gives the investigational product a brochure and no label", () => {
    const vastimab = SEED_DOCUMENTS.filter(
      (doc) => doc.activeSubstance === "vastimab",
    );
    expect(vastimab.map((d) => d.kind)).toEqual(["investigators_brochure"]);
  });

  it("pairs every document with chunks the retrieval layer can reach", () => {
    for (const document of SEED_DOCUMENTS) {
      const chunks = SEED_CHUNKS.filter((c) => c.documentId === document.id);
      expect(chunks.length, document.title).toBe(document.chunkCount);
      expect(chunks.length).toBeGreaterThan(0);
      // Every chunk restates its own source type, and it must be the
      // document's — a company passage cited as public is the one mix-up the
      // whole evidence panel is built to prevent.
      for (const chunk of chunks) {
        expect(chunk.sourceType).toBe(document.sourceType);
      }
    }
  });
});

describe("the divergences the demo is built on", () => {
  /*
    Dermacil: the company document is ahead of the label. Stated as two
    assertions rather than one, because "the CCDS mentions it" and "the label
    does not" fail for different reasons and a single expectation would hide
    which.
  */
  it("has Stevens-Johnson syndrome in the Dermacil CCDS", () => {
    expect(textOf("Dermacil Company Core Data Sheet v9.0")).toContain(
      "Stevens-Johnson syndrome",
    );
  });

  it("does not have it anywhere in the Dermacil label", () => {
    expect(textOf("Dermacil — Prescribing Information")).not.toMatch(
      /stevens-johnson|epidermal necrolysis/i,
    );
  });

  /*
    Pulmoxa: the label is ahead of the company document — the disagreement
    running the other way, which is the pair a reviewer has to tell apart.

    The CCDS does contain the words "interstitial lung disease", inside a
    sentence denying any case was seen. That is deliberate: a search will
    retrieve that passage, and the honest reading of it is that the document
    does not describe the reaction. A corpus where the CCDS simply never said
    the words would prove the retrieval worked and prove nothing about the
    reading.
  */
  it("has interstitial lung disease in the Pulmoxa label", () => {
    expect(textOf("Pulmoxa — Prescribing Information")).toContain(
      "Interstitial lung disease has been reported in patients receiving PULMOXA",
    );
  });

  it("has the Pulmoxa CCDS deny it in so many words", () => {
    expect(textOf("Pulmoxa Company Core Data Sheet v2.3")).toContain(
      "No cases of interstitial lung disease were identified in the pooled safety population",
    );
  });
});

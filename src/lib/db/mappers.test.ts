import { describe, expect, it } from "vitest";
import { Case, NO_SERIOUSNESS_FLAGS } from "@/lib/schemas";
import { asBatch, caseToRows, rowsToCase } from "./mappers";

/**
 * The D1 projection, and the one property that matters about it.
 *
 * A Case goes into three tables and comes back out of three tables. If any
 * field is dropped on the way — a partial date's precision, a seriousness
 * flag's character span, the order of the drugs — nothing fails. The case
 * simply renders slightly wrong, and "slightly wrong" in this application
 * means a highlight over the wrong words or a clock that does not start.
 *
 * So the test is a round trip, asserted with toEqual on the whole value rather
 * than field by field. Field-by-field assertions only catch the fields
 * somebody thought to list, which are never the ones that get lost.
 */

const NARRATIVE =
  "She was admitted to hospital on the 3rd with a rash on both hands.";

function fullCase(): Case {
  return Case.parse({
    id: "11111111-1111-4111-8111-111111111111",
    reference: "SN-2026-500001",
    origin: "public_form",
    receivedAt: "2026-08-01",
    patient: {
      initials: "J.M.",
      ageYears: 61,
      ageGroup: "elderly",
      sex: "female",
      dateOfBirth: null,
      weightKg: 68.5,
      localIdentifier: null,
    },
    reporter: {
      name: "Dr A Reporter",
      organisation: "A Hospital",
      country: "GB",
      email: null,
      phone: null,
      qualification: "physician",
      contactPermitted: true,
    },
    drugs: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        reportedName: "Covaxil",
        activeSubstance: "covaxil",
        role: "suspect",
        marketingStatus: "marketed",
        dose: "0.5 mg daily",
        route: "oral",
        indication: "prophylaxis",
        // The precision travels with the value. If the mapper flattens this to
        // a date string, "March 2026" silently becomes 1 March 2026 and gets
        // compared against the reaction onset to decide causality.
        therapyStart: { value: "2026-03", precision: "month" },
        therapyEnd: null,
        dechallenge: null,
        rechallenge: null,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        reportedName: "Aspirin",
        activeSubstance: "acetylsalicylic acid",
        role: "concomitant",
        marketingStatus: "marketed",
        dose: null,
        route: null,
        indication: null,
        therapyStart: null,
        therapyEnd: null,
        dechallenge: null,
        rechallenge: null,
      },
    ],
    reactions: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        verbatimTerm: "rash on both hands",
        meddraPreferredTerm: null,
        onset: { value: "2026-03-05", precision: "day" },
        outcome: "recovering",
        // Spread from the canonical empty value rather than written out, so
        // adding a seventh criterion breaks the schema and not this fixture.
        seriousness: {
          ...NO_SERIOUSNESS_FLAGS,
          hospitalisation: {
            basis: "narrative",
            assertedBy: "model",
            confirmedByReviewer: false,
            rejectedByReviewer: false,
            kind: "initial",
            trigger: { start: 8, end: 32, quote: NARRATIVE.slice(8, 32) },
          },
        },
      },
    ],
    narrative: NARRATIVE,
    status: "received",
    assignedTo: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  });
}

describe("caseToRows / rowsToCase", () => {
  it("round-trips a full case without losing a field", () => {
    const original = fullCase();
    const rows = caseToRows(original);

    expect(rowsToCase(rows.caseRow, rows.drugRows, rows.reactionRows)).toEqual(
      original,
    );
  });

  it("keeps the reported order of drugs, whatever order the rows arrive in", () => {
    const original = fullCase();
    const rows = caseToRows(original);

    // SQLite makes no promise about row order without an ORDER BY, and the
    // first-named drug is usually the one the reporter blames.
    const shuffled = [...rows.drugRows].reverse();
    const restored = rowsToCase(rows.caseRow, shuffled, rows.reactionRows);

    expect(restored.drugs.map((d) => d.reportedName)).toEqual([
      "Covaxil",
      "Aspirin",
    ]);
  });

  it("derives `serious` from the flags rather than trusting a caller", () => {
    const rows = caseToRows(fullCase());
    // Hospitalisation is one of the six criteria, so this case is serious and
    // the index column has to agree with the JSON beside it.
    expect(rows.reactionRows[0]?.serious).toBe(true);
  });

  it("does not read `serious` back — the flags are authoritative", () => {
    const original = fullCase();
    const rows = caseToRows(original);

    // A stale index column must not become the answer to "is this case
    // serious", because that answer starts or fails to start a 15-day clock.
    const tampered = rows.reactionRows.map((row) => ({
      ...row,
      serious: false,
    }));
    const restored = rowsToCase(rows.caseRow, rows.drugRows, tampered);

    expect(restored.reactions[0]?.seriousness.hospitalisation).not.toBeNull();
  });

  it("refuses a row whose JSON column is not JSON", () => {
    const rows = caseToRows(fullCase());
    const broken = { ...rows.caseRow, patient: "{not json" };

    // Returning null here would render as "no identifiable patient", which is
    // a failed validity criterion — a clinical claim about the report rather
    // than a fault in our storage.
    expect(() =>
      rowsToCase(broken, rows.drugRows, rows.reactionRows),
    ).toThrow(/did not contain JSON/);
  });

  it("refuses a row that no longer satisfies the schema", () => {
    const rows = caseToRows(fullCase());
    const stale = { ...rows.caseRow, status: "a_status_we_retired" };

    expect(() =>
      rowsToCase(stale, rows.drugRows, rows.reactionRows),
    ).toThrow();
  });
});

describe("asBatch", () => {
  it("preserves the non-empty guarantee instead of casting it away", () => {
    expect(asBatch([1, 2, 3])).toEqual([1, 2, 3]);
    expect(() => asBatch([])).toThrow(/empty D1 batch/);
  });
});

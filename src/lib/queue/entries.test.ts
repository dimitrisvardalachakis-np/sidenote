/**
 * The queue lists each case once.
 *
 * This is a regression test with a deployment behind it. The twelve demo cases
 * are built in code, and nothing pointed a foreign key at them until
 * `assessments.case_id` did — so they had to become rows in `cases` as well.
 * The moment they were, the queue had two sources for the same case: the
 * fixture, and the store listing that now contains it.
 *
 * `loadQueue` drops the store's copy and keeps the fixture, because the fixture
 * recomputes its dates from `today` and the row cannot. A submitted case, which
 * exists only in the store, must still come through untouched — that is the
 * half a naive filter would break.
 */
import { describe, expect, it, vi } from "vitest";
import { CaseId, CaseReference, IsoDate } from "@/lib/schemas";
import type { Case } from "@/lib/schemas";

const TODAY = IsoDate.parse("2026-08-31");

const { buildSeedCases } = await import("@/lib/fixtures/seed");

/** The fixture, as the store would hand it back after the seed SQL ran. */
const seededFromStore = buildSeedCases(TODAY)[0]?.record as Case;

/** A case that genuinely only exists in the store. */
const submitted: Case = {
  ...seededFromStore,
  id: CaseId.parse("00000002-0000-4000-8000-000000009999"),
  reference: CaseReference.parse("SN-2026-500001"),
};

vi.mock("@/lib/store/case-store", () => ({
  getCaseStore: async () => ({
    list: async () => [seededFromStore, submitted],
  }),
}));

vi.mock("@/lib/store/assessment-store", () => ({
  getAssessmentStore: async () => ({
    get: async () => null,
    getMany: async () => new Map(),
  }),
}));

const { loadQueue } = await import("./entries");

describe("loadQueue", () => {
  it("lists a seeded case once even when the store also holds it", async () => {
    const entries = await loadQueue(TODAY);
    const ids = entries.map((e) => e.record.id);
    const seededId = seededFromStore.id;

    expect(ids.filter((id) => id === seededId)).toHaveLength(1);
  });

  it("keeps the fixture rather than the store's row", async () => {
    const entries = await loadQueue(TODAY);
    const entry = entries.find((e) => e.record.id === seededFromStore.id);

    // The fixture carries a seeded assessment; the mocked store reports none.
    // Whichever survived is identifiable by that.
    expect(entry?.assessment).not.toBeNull();
  });

  it("still lists a case that only the store has", async () => {
    const entries = await loadQueue(TODAY);
    const ids = entries.map((e) => e.record.id);

    expect(ids).toContain(submitted.id);
  });

  it("lists every seeded case", async () => {
    const entries = await loadQueue(TODAY);
    const seededIds = buildSeedCases(TODAY).map((s) => s.record.id);

    for (const id of seededIds) expect(entries.map((e) => e.record.id)).toContain(id);
  });
});

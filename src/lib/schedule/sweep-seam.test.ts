import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSeedCases } from "@/lib/fixtures/seed";
import { getCaseStore } from "@/lib/store/case-store";
import { getAssessmentStore } from "@/lib/store/assessment-store";
import { runDeadlineSweep } from "./deadline-sweep";
import type { IsoDate } from "@/lib/schemas";

/**
 * Does the nightly sweep see what a reviewer wrote?
 *
 * It did not, and nothing said so. `deadline-sweep` read assessments straight
 * out of D1 through `assessmentsForCases`, while every reviewer assessment was
 * written through `getAssessmentStore()` — which had no D1 branch. Two stores
 * over one concept again, and the same shape as the claim bug: a write path
 * and a read path pointing at different places with nothing between them.
 *
 * The cost was the whole point of the app. With no assessment visible,
 * `ruledListedness` is null, `applies` is false for every case, and the
 * expedited clock never arms — so a serious unlisted case with a 15-day
 * regulatory obligation produced no alarm, no overdue marker and no audit
 * line, on every backing there is.
 *
 * `coordination.test.ts` passed throughout, as did every sweep test: each half
 * was correct on its own. This asserts the seam, which is the only place the
 * defect existed.
 */
const TODAY = "2026-08-31" as IsoDate;

function pretendToBeWorkers(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

function resetEphemeralStores(): void {
  delete (globalThis as unknown as { __sidenoteEphemeralStores?: unknown })
    .__sidenoteEphemeralStores;
}

/** The sweep's own audit line, parsed back out of the console. */
function captureSweep(): { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, "log").mockImplementation((raw: unknown) => {
    const text = String(raw);
    if (!text.startsWith("[AUDIT] ")) return;
    try {
      lines.push(
        JSON.parse(text.slice("[AUDIT] ".length)) as Record<string, unknown>,
      );
    } catch {
      // Not our business here; the audit format has its own tests.
    }
  });
  return { lines };
}

function detailOf(
  lines: readonly Record<string, unknown>[],
  action: string,
): Record<string, unknown> | undefined {
  const line = lines.find((l) => l["action"] === action);
  return line?.["detail"] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  resetEphemeralStores();
  pretendToBeWorkers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the deadline sweep and the reviewer's assessment", () => {
  it("arms a clock for a serious case a reviewer ruled unlisted", async () => {
    // Fixture 101: serious, fatal, and ruled `unlisted` — the case the demo
    // opens on, and the one whose clock is the headline.
    const seeded = buildSeedCases(TODAY);
    const overdue = seeded.find(
      (s) => s.assessment.ruling?.listedness === "unlisted",
    );
    if (overdue === undefined) throw new Error("no unlisted fixture to sweep");

    await (await getCaseStore()).put(overdue.record);
    // Written the way a reviewer writes it — through the store, not through
    // whatever the sweep happens to read.
    await (await getAssessmentStore()).put(overdue.assessment);

    const { lines } = captureSweep();
    await runDeadlineSweep(TODAY);

    const detail = detailOf(lines, "deadline_sweep");
    expect(detail?.["examined"]).toBe(1);
    // The assertion the bug would have failed: zero, on every backing.
    expect(detail?.["armed"]).toBe(1);
  });

  it("arms nothing for a case nobody has assessed", async () => {
    const seeded = buildSeedCases(TODAY);
    const overdue = seeded.find(
      (s) => s.assessment.ruling?.listedness === "unlisted",
    );
    if (overdue === undefined) throw new Error("no unlisted fixture to sweep");

    await (await getCaseStore()).put(overdue.record);
    // Deliberately NOT stored. Until a human has ruled, `unlisted` is not
    // established, and arming on a suggestion would put a red overdue marker
    // on a case nobody has looked at.

    const { lines } = captureSweep();
    await runDeadlineSweep(TODAY);

    const detail = detailOf(lines, "deadline_sweep");
    expect(detail?.["examined"]).toBe(1);
    expect(detail?.["armed"]).toBe(0);
  });
});

describe("the store the sweep reads", () => {
  it("returns what was put through it, in bulk", async () => {
    const seeded = buildSeedCases(TODAY).slice(0, 3);
    const store = await getAssessmentStore();
    for (const s of seeded) await store.put(s.assessment);

    const found = await store.getMany(seeded.map((s) => s.record.id));
    expect(found.size).toBe(3);
    for (const s of seeded) {
      expect(found.get(s.record.id)?.id).toBe(s.assessment.id);
    }
  });
});

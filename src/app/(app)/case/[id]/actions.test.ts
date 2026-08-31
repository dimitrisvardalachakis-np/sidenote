import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seam, and the only kind of test that would have caught it.
 *
 * `coordination.test.ts` exercises the coordinator in isolation and passed
 * throughout the outage, because the outage was never inside the coordinator.
 * It was between the write and the render: `claimCase` wrote through
 * `getCaseCoordination()` and every screen read `getClaimStore()`, with
 * nothing copying one into the other. So this claims through the Server Action
 * and then reads back through the function the page itself calls.
 */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

/** Nothing renders here, so revalidation has nothing to revalidate. */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { startSession } = await import("@/lib/auth");
const { claimCase, releaseCase, recordRuling } = await import("./actions");
const { getAssessmentStore } = await import("@/lib/store/assessment-store");
const { buildSeedCases } = await import("@/lib/fixtures/seed");
const { INITIAL_RULING_STATE, IDEMPOTENCY_FIELD } = await import(
  "./ruling-state"
);
const { getCaseCoordination } = await import("@/lib/coordinator");
const { INITIAL_CLAIM_STATE } = await import("./ruling-state");

/** A seeded fixture, and deliberately not one of the two seeded holders. */
const CASE = "00000002-0000-4000-8000-000000000102";
/** One that IS. The screen CLAUDE.md calls the central conflict. */
const HELD_BY_AO = "00000002-0000-4000-8000-000000000105";

beforeEach(() => {
  jar.clear();
});

describe("claiming a case, through the action and back out the read path", () => {
  it("shows on the read the case screen makes", async () => {
    await startSession("reviewer-demo");
    const outcome = await claimCase(CASE, INITIAL_CLAIM_STATE);
    expect(outcome.status).toBe("granted");

    // The exact call `case/[id]/page.tsx` makes.
    const state = await (await getCaseCoordination()).state(CASE);
    expect(state.claim?.reviewerId).toBe("reviewer-demo");
  });

  it("shows in the map the queue and the rail build their rows from", async () => {
    await startSession("reviewer-demo");
    await claimCase(CASE, INITIAL_CLAIM_STATE);

    // The exact call `queue/page.tsx` and `(app)/layout.tsx` make.
    const held = await (await getCaseCoordination()).held();
    expect(held.get(CASE)?.reviewerId).toBe("reviewer-demo");
  });

  it("stops showing on both reads once released", async () => {
    await startSession("reviewer-demo");
    await claimCase(CASE, INITIAL_CLAIM_STATE);
    await releaseCase(CASE, INITIAL_CLAIM_STATE);

    const coordination = await getCaseCoordination();
    expect((await coordination.state(CASE)).claim).toBeNull();
    expect((await coordination.held()).has(CASE)).toBe(false);
  });
});

describe("the fixture holders", () => {
  it("hold their cases before anyone has touched them", async () => {
    await startSession("reviewer-demo");
    const coordination = await getCaseCoordination();

    expect((await coordination.held()).get(HELD_BY_AO)?.displayName).toBe(
      "A. Okonkwo",
    );
    expect((await coordination.state(HELD_BY_AO)).claim?.reviewerId).toBe(
      "reviewer-ao",
    );
  });

  it("refuse a reviewer who is not them", async () => {
    await startSession("reviewer-demo");
    const outcome = await claimCase(HELD_BY_AO, INITIAL_CLAIM_STATE);

    // Not merely rendered as held — actually refused, by the same code path
    // that would refuse a live claim from a colleague.
    expect(outcome.status).toBe("held_by_other");
  });

  it("do not spring back once the holder releases", async () => {
    await startSession("reviewer-ao");
    await releaseCase(HELD_BY_AO, INITIAL_CLAIM_STATE);

    // Deleting the claim rather than lapsing it would return the object to
    // never-spoken, and the fixture would take the case straight back.
    const coordination = await getCaseCoordination();
    expect((await coordination.state(HELD_BY_AO)).claim).toBeNull();
    expect((await coordination.held()).has(HELD_BY_AO)).toBe(false);
  });
});

describe("the stand-in says what it is", () => {
  it("reports that it does not arbitrate", async () => {
    // Read by the case screen and printed under the claim control. If this
    // ever returns true without a Durable Object behind it, the screen starts
    // promising a guarantee a Map cannot keep.
    expect((await getCaseCoordination()).arbitrates).toBe(false);
  });
});

/**
 * Idempotency, at the level where it was NOT holding.
 *
 * `coordination.test.ts` proves the object returns the cached result under a
 * repeated key, and it always did. What it cannot see is what the ACTION does
 * afterwards: the mirror write and the audit line sat outside the replay
 * guard, so a double-submitted ruling re-wrote the assessment with a fresh
 * `updatedAt` and emitted a second `rule_case` success line at a second
 * instant. `case-coordinator.ts` names that outright as the defect the whole
 * mechanism exists to prevent — a regulatory trail saying a determination was
 * made twice — and the mechanism was preventing it only inside the object.
 *
 * Found by replaying a claim against a real Durable Object under
 * `wrangler dev` and counting the lines: two from the object, three from the
 * action.
 */
function auditLines(): { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, "log").mockImplementation((raw: unknown) => {
    const text = String(raw);
    if (!text.startsWith("[AUDIT] ")) return;
    try {
      lines.push(
        JSON.parse(text.slice("[AUDIT] ".length)) as Record<string, unknown>,
      );
    } catch {
      // The audit format has its own tests; this one counts.
    }
  });
  return { lines };
}

function withKey(key: string): FormData {
  const form = new FormData();
  form.set(IDEMPOTENCY_FIELD, key);
  return form;
}

function countOf(
  lines: readonly Record<string, unknown>[],
  action: string,
): { total: number; replays: number } {
  const matching = lines.filter((l) => l["action"] === action);
  return {
    total: matching.length,
    replays: matching.filter(
      (l) => (l["detail"] as { replayed?: boolean } | undefined)?.replayed === true,
    ).length,
  };
}

describe("a replayed submission is recorded once", () => {
  it("logs the retry as a replay, not as a second grant", async () => {
    await startSession("reviewer-demo");
    const caseId = "00000002-0000-4000-8000-000000000107";
    const key = "one-press-of-one-button";

    const { lines } = auditLines();
    await claimCase(caseId, INITIAL_CLAIM_STATE, withKey(key));
    await claimCase(caseId, INITIAL_CLAIM_STATE, withKey(key));

    const claims = countOf(lines, "claim_case");
    // Both requests are still recorded — a retry that reached the server is an
    // event. What must not appear twice is the grant itself.
    expect(claims.total).toBe(2);
    expect(claims.replays).toBe(1);
  });

  it("does not write a second ruling or a second determination line", async () => {
    await startSession("reviewer-demo");
    const seeded = buildSeedCases("2026-08-31" as never).find(
      (s) => s.assessment.ruling !== null,
    );
    if (seeded === undefined) throw new Error("no assessed fixture");
    const caseId = seeded.record.id;

    // recordRuling refuses without an assessment to attach the ruling to, and
    // without the claim. Both are the reviewer's ordinary path.
    await (await getAssessmentStore()).put(seeded.assessment);
    await claimCase(caseId, INITIAL_CLAIM_STATE);

    const form = withKey("one-press-of-the-ruling-button");
    form.set("listedness", "unlisted");
    form.set("expectedness", "unexpected");
    form.set("rationale", "Neither document describes a reaction of this kind.");

    const { lines } = auditLines();
    const first = await recordRuling(caseId, INITIAL_RULING_STATE, form);
    const replay = await recordRuling(caseId, INITIAL_RULING_STATE, form);

    expect(first.status).toBe("recorded");
    // The reviewer sees the same answer either way: the ruling IS recorded.
    expect(replay.status).toBe("recorded");

    const rulings = countOf(lines, "rule_case");
    expect(rulings.total).toBe(2);
    // Exactly one line claims a determination was made. The other says it was
    // a replay, which is the difference between an audit trail and a lie.
    expect(rulings.replays).toBe(1);
  });
});

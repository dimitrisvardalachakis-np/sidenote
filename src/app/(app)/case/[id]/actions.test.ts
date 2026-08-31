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
const { claimCase, releaseCase } = await import("./actions");
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

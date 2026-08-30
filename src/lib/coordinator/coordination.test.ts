import { describe, expect, it } from "vitest";
import { getCaseCoordination } from "./index";
import type { ReviewerRuling } from "@/lib/schemas";

/**
 * "Two reviewers opening the same case is the central conflict this app exists
 * to resolve." — CLAUDE.md.
 *
 * These run against the in-process stand-in, because a Durable Object needs a
 * Durable Object runtime. That is worth being honest about: what is proven
 * here is the CONTRACT — who may claim, who may rule, what a refusal says —
 * and not the concurrency guarantee, which is the platform's and cannot be
 * demonstrated in a single-threaded test anyway.
 *
 * The two implementations are held to the same contract deliberately, so a
 * change to one that breaks these tests is a change that would have broken the
 * other.
 */

const ALICE = { id: "reviewer-alice", name: "Dr Alice Osei" };
const BOB = { id: "reviewer-bob", name: "Dr Bob Nair" };

function ruling(by: string): ReviewerRuling {
  return {
    listedness: "unlisted",
    expectedness: "unexpected",
    decidedBy: by,
    decidedAt: "2026-08-25T10:00:00.000Z",
    rationale: "Neither document describes a cutaneous reaction of this kind.",
  } as ReviewerRuling;
}

/** A fresh case id per test — the stand-in is a module singleton. */
let n = 0;
function caseId(): string {
  n += 1;
  return `case-${n}`;
}

describe("claiming", () => {
  it("grants an unheld case", async () => {
    const c = await getCaseCoordination();
    const id = caseId();

    const outcome = await c.claim(id, ALICE.id, ALICE.name);

    expect(outcome.kind).toBe("granted");
    expect((await c.state(id)).claim?.reviewerId).toBe(ALICE.id);
  });

  it("refuses a case somebody else holds, and names them", async () => {
    const c = await getCaseCoordination();
    const id = caseId();
    await c.claim(id, ALICE.id, ALICE.name);

    const outcome = await c.claim(id, BOB.id, BOB.name);

    expect(outcome.kind).toBe("held_by_other");
    if (outcome.kind !== "held_by_other") throw new Error("expected a refusal");
    // "Someone else has it" is not actionable. A name and a time is.
    expect(outcome.claim.displayName).toBe(ALICE.name);
    expect(outcome.claim.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refreshes rather than refusing when the holder re-claims", async () => {
    const c = await getCaseCoordination();
    const id = caseId();
    const first = await c.claim(id, ALICE.id, ALICE.name);
    const second = await c.claim(id, ALICE.id, ALICE.name);

    // A reviewer who reloads the page has not lost their claim, and a system
    // that says "you cannot have this, you have it" is one people distrust.
    expect(second.kind).toBe("already_yours");
    if (first.kind === "held_by_other" || second.kind === "held_by_other") {
      throw new Error("expected the holder to keep the case");
    }
    // The window moves; the moment they took it does not.
    expect(second.claim.heldSince).toBe(first.claim.heldSince);
  });

  it("lets go only for the holder", async () => {
    const c = await getCaseCoordination();
    const id = caseId();
    await c.claim(id, ALICE.id, ALICE.name);

    // Otherwise "release" is just "steal" spelled politely.
    await c.release(id, BOB.id);
    expect((await c.state(id)).claim?.reviewerId).toBe(ALICE.id);

    await c.release(id, ALICE.id);
    expect((await c.state(id)).claim).toBeNull();
  });

  it("frees a case once released", async () => {
    const c = await getCaseCoordination();
    const id = caseId();
    await c.claim(id, ALICE.id, ALICE.name);
    await c.release(id, ALICE.id);

    expect((await c.claim(id, BOB.id, BOB.name)).kind).toBe("granted");
  });
});

describe("ruling", () => {
  it("refuses a ruling on an unclaimed case", async () => {
    const c = await getCaseCoordination();
    const id = caseId();

    const result = await c.rule(id, ruling(ALICE.id));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Claim this case/);
  });

  it("refuses a ruling from someone who does not hold the case", async () => {
    const c = await getCaseCoordination();
    const id = caseId();
    await c.claim(id, ALICE.id, ALICE.name);

    const result = await c.rule(id, ruling(BOB.id));

    // Two people deciding one case is the same failure as two people opening
    // it, with a regulatory consequence attached.
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(ALICE.name);
  });

  it("records a ruling from the holder", async () => {
    const c = await getCaseCoordination();
    const id = caseId();
    await c.claim(id, ALICE.id, ALICE.name);

    const result = await c.rule(id, ruling(ALICE.id));

    expect(result.ok).toBe(true);
    expect(result.state.ruling?.listedness).toBe("unlisted");
    expect((await c.state(id)).ruling?.decidedBy).toBe(ALICE.id);
  });
});

describe("the stand-in", () => {
  it("admits that it does not arbitrate", async () => {
    const c = await getCaseCoordination();
    // With no Durable Object bound this is false, and the case screen says so
    // in as many words. A stub that claimed to arbitrate would be the one lie
    // this feature cannot afford.
    expect(c.arbitrates).toBe(false);
  });
});

describe("idempotency keys", () => {
  /*
    The case the Durable Object does NOT already solve.

    Serialisation stops two reviewers ruling at once. It does not stop one
    reviewer's request arriving twice — a double-click, a browser retry, a
    Server Action replayed after a timeout the client saw and the server did
    not. Those get ordered, not merged.
  */
  it("collapses a replayed ruling instead of recording it twice", async () => {
    const c = await getCaseCoordination();
    const id = "case-idem-ruling";
    await c.claim(id, ALICE.id, ALICE.name);

    const key = "ruling-attempt-1";
    const first = await c.rule(id, ruling(ALICE.id), key);
    const replay = await c.rule(id, ruling(ALICE.id), key);

    expect(first.ok).toBe(true);
    // Not merely "also ok" — the SAME result object, because the second call
    // must not have re-run the mutation at all.
    expect(replay).toEqual(first);
  });

  it("collapses a double-clicked claim", async () => {
    const c = await getCaseCoordination();
    const id = "case-idem-claim";

    const key = "claim-attempt-1";
    const first = await c.claim(id, ALICE.id, ALICE.name, key);
    const replay = await c.claim(id, ALICE.id, ALICE.name, key);

    expect(first.kind).toBe("granted");
    // Without the key this would come back "already_yours" with a moved
    // expiry. A replay is not a second intent and must not read as one.
    expect(replay).toEqual(first);
  });

  it("treats a different key as a different intent", async () => {
    const c = await getCaseCoordination();
    const id = "case-idem-distinct";

    const first = await c.claim(id, ALICE.id, ALICE.name, "press-1");
    const second = await c.claim(id, ALICE.id, ALICE.name, "press-2");

    expect(first.kind).toBe("granted");
    // A genuine second press, deliberately made: it extends rather than
    // replays, which is what re-claiming your own case is supposed to do.
    expect(second.kind).toBe("already_yours");
  });

  it("still refuses a second reviewer, key or no key", async () => {
    const c = await getCaseCoordination();
    const id = "case-idem-contested";

    await c.claim(id, ALICE.id, ALICE.name, "alice-press");
    const bob = await c.claim(id, BOB.id, BOB.name, "bob-press");

    // The guarantee the whole class exists for is not weakened by any of this.
    expect(bob.kind).toBe("held_by_other");
  });
});

describe("minting references", () => {
  it("never returns the same number twice", async () => {
    const c = await getCaseCoordination();
    const year = 2031;

    const minted = await Promise.all(
      Array.from({ length: 25 }, () => c.mintReference(year, 0)),
    );

    // The whole reason this moved into a Durable Object: count-then-add hands
    // the same reference to two reports submitted in the same second, and that
    // number is what a patient is told to quote on the phone.
    expect(new Set(minted).size).toBe(minted.length);
    for (const reference of minted) {
      expect(reference).toMatch(/^SN-2031-5\d{5}$/);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  canRelease,
  canWrite,
  claimExpiryFrom,
  claimOutcome,
  writeBlockedReason,
  type CaseClaim,
} from "./claim";

const NOW = "2026-08-29T14:02:00Z";
/** Inside the 30-minute window. The tests below are about holding, not lapsing. */
const SOON = "2026-08-29T14:20:00Z";
/** Well past it. The lapse tests, and nothing else, use this. */
const LATER = "2026-08-29T16:30:00Z";

const held = (reviewerId: string, displayName: string): CaseClaim => ({
  reviewerId,
  displayName,
  heldSince: NOW,
  expiresAt: claimExpiryFrom(NOW),
});

describe("claimOutcome", () => {
  it("grants an unheld case", () => {
    const out = claimOutcome({
      current: null,
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      now: NOW,
    });
    expect(out.kind).toBe("granted");
    expect(out.claim).toEqual({
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      heldSince: NOW,
      expiresAt: claimExpiryFrom(NOW),
    });
  });

  it("reports a case you already hold without treating it as an error", () => {
    const out = claimOutcome({
      current: held("reviewer-demo", "Demo Reviewer"),
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      now: SOON,
    });
    expect(out.kind).toBe("already_yours");
  });

  /*
    Re-pressing Claim must not reset the clock. That number is what a colleague
    uses to decide whether to interrupt you, and a claim that says "held for 2
    minutes" after three hours is worse than no number at all.
  */
  it("keeps the original heldSince when you re-claim your own case", () => {
    const out = claimOutcome({
      current: held("reviewer-demo", "Demo Reviewer"),
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      now: SOON,
    });
    expect(out.claim.heldSince).toBe(NOW);
  });

  /*
    The lapse. Its whole purpose is that a case is not locked by somebody who
    went home, so the test that matters is that a STRANGER gets it back — not
    merely that the holder is allowed to renew.
  */
  it("grants a lapsed case to somebody else", () => {
    const out = claimOutcome({
      current: held("reviewer-ao", "A. Okonkwo"),
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      now: LATER,
    });
    expect(out.kind).toBe("granted");
    expect(out.claim.reviewerId).toBe("reviewer-demo");
    // Held since NOW, not since the lapsed holder took it.
    expect(out.claim.heldSince).toBe(LATER);
  });

  it("extends the window when you re-claim inside it", () => {
    const out = claimOutcome({
      current: held("reviewer-demo", "Demo Reviewer"),
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      now: SOON,
    });
    expect(out.claim.expiresAt).toBe(claimExpiryFrom(SOON));
    // The clock on how long they have had it does NOT reset.
    expect(out.claim.heldSince).toBe(NOW);
  });

  it("reports the holder when somebody else has it, rather than throwing", () => {
    const out = claimOutcome({
      current: held("reviewer-ao", "A. Okonkwo"),
      reviewerId: "reviewer-demo",
      displayName: "Demo Reviewer",
      now: SOON,
    });
    expect(out.kind).toBe("held_by_other");
    expect(out.claim.displayName).toBe("A. Okonkwo");
    expect(out.claim.heldSince).toBe(NOW);
  });
});

describe("who may write", () => {
  it("refuses an unclaimed case", () => {
    expect(canWrite(null, "reviewer-demo", NOW)).toBe(false);
    expect(writeBlockedReason(null, "reviewer-demo", NOW)).toBe("Claim this case first.");
  });

  it("allows the holder", () => {
    const claim = held("reviewer-demo", "Demo Reviewer");
    expect(canWrite(claim, "reviewer-demo", NOW)).toBe(true);
    expect(writeBlockedReason(claim, "reviewer-demo", NOW)).toBeNull();
  });

  it("refuses everybody else, and names who is holding it", () => {
    const claim = held("reviewer-ao", "A. Okonkwo");
    expect(canWrite(claim, "reviewer-demo", NOW)).toBe(false);
    expect(writeBlockedReason(claim, "reviewer-demo", NOW)).toBe(
      "A. Okonkwo has this case.",
    );
  });
});

describe("who may release", () => {
  it("allows only the holder", () => {
    expect(canRelease(held("reviewer-demo", "Demo Reviewer"), "reviewer-demo", NOW)).toBe(true);
    expect(canRelease(held("reviewer-ao", "A. Okonkwo"), "reviewer-demo", NOW)).toBe(false);
    expect(canRelease(null, "reviewer-demo", NOW)).toBe(false);
  });

  it("refuses the holder once their claim has lapsed", () => {
    const claim = held("reviewer-demo", "Demo Reviewer");
    expect(canWrite(claim, "reviewer-demo", LATER)).toBe(false);
    expect(canRelease(claim, "reviewer-demo", LATER)).toBe(false);
    expect(writeBlockedReason(claim, "reviewer-demo", LATER)).toBe(
      "That claim has lapsed. Claim it again.",
    );
  });
});

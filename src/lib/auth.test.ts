import { describe, expect, it } from "vitest";
import {
  DEMO_REVIEWERS,
  checkPassword,
  findReviewerByEmail,
  reviewerPassword,
} from "./auth";
import { InMemoryRateLimiter, SIGNIN_POLICY } from "./protection/rate-limit";

/**
 * The sign-in gate.
 *
 * There is one shared password in front of every case in the queue, so these
 * are the tests that say the gate is a gate. They deliberately do not test the
 * Server Action itself — that reads cookies and redirects, and what is worth
 * pinning down is the decision it makes, not Next's plumbing.
 */

describe("findReviewerByEmail", () => {
  it("finds each demo identity by its address", () => {
    for (const reviewer of DEMO_REVIEWERS) {
      expect(findReviewerByEmail(reviewer.email)?.id).toBe(reviewer.id);
    }
  });

  it("forgives case and surrounding space, because people paste", () => {
    expect(findReviewerByEmail("  DEMO@SideNote.Example  ")?.id).toBe(
      "reviewer-demo",
    );
  });

  it("returns null for an address that is not one of ours", () => {
    expect(findReviewerByEmail("someone@example.com")).toBeNull();
    expect(findReviewerByEmail("")).toBeNull();
  });

  it("gives every identity a distinct address", () => {
    const addresses = new Set(DEMO_REVIEWERS.map((r) => r.email));
    expect(addresses.size).toBe(DEMO_REVIEWERS.length);
  });
});

describe("checkPassword", () => {
  it("accepts the configured password", async () => {
    expect(await checkPassword(reviewerPassword())).toBe(true);
  });

  it("rejects a wrong one, an empty one, and a near miss", async () => {
    expect(await checkPassword("hunter2")).toBe(false);
    expect(await checkPassword("")).toBe(false);
    // One character short: the comparison must not accept a prefix.
    expect(await checkPassword(reviewerPassword().slice(0, -1))).toBe(false);
  });

  it("rejects a candidate that is longer than the password", async () => {
    expect(await checkPassword(`${reviewerPassword()}x`)).toBe(false);
  });
});

describe("the sign-in ceiling", () => {
  /*
    A password with nothing counting the attempts invites the belief that the
    queue is protected. This is the same limiter the action consults, under
    the same policy, so the number here cannot drift from the number shipped.
  */
  it("refuses once the policy's limit is passed", async () => {
    const limiter = new InMemoryRateLimiter(SIGNIN_POLICY);
    for (let attempt = 0; attempt < SIGNIN_POLICY.limit; attempt += 1) {
      expect((await limiter.check("sign_in:1.2.3.4")).allowed).toBe(true);
    }
    const refused = await limiter.check("sign_in:1.2.3.4");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each address separately, so one guesser cannot lock everyone out", async () => {
    const limiter = new InMemoryRateLimiter(SIGNIN_POLICY);
    for (let attempt = 0; attempt < SIGNIN_POLICY.limit + 1; attempt += 1) {
      await limiter.check("sign_in:1.2.3.4");
    }
    expect((await limiter.check("sign_in:5.6.7.8")).allowed).toBe(true);
  });
});

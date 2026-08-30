/**
 * One case, one reviewer.
 *
 * CLAUDE.md says two reviewers opening the same case is the central conflict
 * this app exists to resolve. This is the arbitration, as a pure function over
 * the current claim and who is asking — so the interesting case, losing the
 * race, is a VALUE the screen can render rather than an exception somebody has
 * to remember to catch.
 *
 * THE CLAIM LAPSES, AND THAT WAS AN ARGUMENT WORTH HAVING.
 *
 * This file used to say the opposite, in a paragraph defending a permanent
 * claim: a lapse "would let two reviewers rule on one case during a long
 * lunch". The Cluster C branch's schema said the reverse just as firmly —
 * without a lapse, somebody opens a case at 16:55 on Friday, shuts the laptop,
 * and a serious unlisted report sits locked with its 15-day clock running.
 *
 * The Durable Object settles it, because it invalidates the original argument.
 * A lapsed claim never produces two rulings: `rule()` re-reads the live claim
 * inside a single-threaded object, so a reviewer whose claim expired while
 * they were at lunch is refused the WRITE, not merely the lock. What the lapse
 * actually produces is a handover — and in a domain with a regulatory deadline
 * counted in days, a case nobody can touch until Monday is the worse of the
 * two failures by a distance.
 *
 * So the lapse comes in, and the reverse failure is handled by making the
 * window generous rather than short: a reviewer reading a forty-page CCDS is
 * doing exactly what the app is for, and re-claiming your own case extends it,
 * so the ceiling only bites when somebody has genuinely walked away.
 */
import type { IsoDateTime } from "@/lib/schemas";

/**
 * Long enough to read a CCDS, short enough that Friday evening does not cost
 * the case a weekend.
 */
export const CLAIM_TTL_MINUTES = 30;

export interface CaseClaim {
  readonly reviewerId: string;
  /** Shown on screen, so a colleague is named rather than identified by id. */
  readonly displayName: string;
  readonly heldSince: IsoDateTime;
  /**
   * When this claim stops being honoured.
   *
   * Stored rather than derived from `heldSince` + the constant above: the TTL
   * can change with a deploy, and a claim taken under the old one should keep
   * the window it was granted rather than silently gain or lose time.
   */
  readonly expiresAt: IsoDateTime;
}

export type ClaimOutcome =
  /** Nobody held it, they released it, or their claim lapsed. It is yours now. */
  | { readonly kind: "granted"; readonly claim: CaseClaim }
  /** You already hold it; the window is extended. Not an error, not a new claim. */
  | { readonly kind: "already_yours"; readonly claim: CaseClaim }
  /** Somebody else holds it, and their claim is still live. The screen worth designing. */
  | { readonly kind: "held_by_other"; readonly claim: CaseClaim };

export interface ClaimRequest {
  readonly current: CaseClaim | null;
  readonly reviewerId: string;
  readonly displayName: string;
  /** Passed in rather than read from the clock, so this stays pure. */
  readonly now: IsoDateTime;
}

/**
 * Is this claim still being honoured?
 *
 * Expiry is applied on READ rather than by a timer, which is what lets the
 * same predicate serve a pure function here and a Durable Object that may have
 * been asleep for an hour. A timer would mean the lapse depends on the object
 * still being awake — so a claim would expire only once somebody arrived to be
 * blocked by it, which is precisely when it must already be gone.
 */
export function claimIsLive(claim: CaseClaim, now: IsoDateTime): boolean {
  return claim.expiresAt > now;
}

/** `now` + the TTL, as the stamp a granted or extended claim carries. */
export function claimExpiryFrom(now: IsoDateTime): IsoDateTime {
  return new Date(
    Date.parse(now) + CLAIM_TTL_MINUTES * 60_000,
  ).toISOString() as IsoDateTime;
}

/**
 * Who ends up holding the case.
 *
 * A lapsed claim is treated exactly as no claim at all — one branch, not two,
 * so there is no path on which an expired holder is still consulted.
 */
export function claimOutcome(request: ClaimRequest): ClaimOutcome {
  const { current, reviewerId, displayName, now } = request;
  const live = current !== null && claimIsLive(current, now) ? current : null;

  if (live === null) {
    return {
      kind: "granted",
      claim: {
        reviewerId,
        displayName,
        heldSince: now,
        expiresAt: claimExpiryFrom(now),
      },
    };
  }

  if (live.reviewerId === reviewerId) {
    // Held since when they FIRST claimed it, not now. Re-pressing a button
    // must not quietly reset how long they have had it, because that number is
    // what a colleague uses to decide whether to interrupt them. The EXPIRY
    // does move — that is what makes re-claiming an extension.
    return {
      kind: "already_yours",
      claim: { ...live, expiresAt: claimExpiryFrom(now) },
    };
  }

  return { kind: "held_by_other", claim: live };
}

/**
 * Whether this reviewer may write to the case at all.
 *
 * Takes `now` because a claim that has lapsed confers nothing, and a write
 * authorised by an expired claim is the exact hole the lapse would otherwise
 * open.
 */
export function canWrite(
  claim: CaseClaim | null,
  reviewerId: string,
  now: IsoDateTime,
): boolean {
  return (
    claim !== null && claim.reviewerId === reviewerId && claimIsLive(claim, now)
  );
}

/**
 * Why a write control is disabled, in words, or null when it is not.
 *
 * Returned as a sentence rather than a boolean because every disabled control
 * on this screen has to say why it is disabled — the pattern the existing
 * Assess control already gets right, and the difference between an interface
 * that looks broken and one that looks deliberate.
 */
export function writeBlockedReason(
  claim: CaseClaim | null,
  reviewerId: string,
  now: IsoDateTime,
): string | null {
  if (claim === null) return "Claim this case first.";
  if (!claimIsLive(claim, now)) return "That claim has lapsed. Claim it again.";
  if (claim.reviewerId === reviewerId) return null;
  return `${claim.displayName} has this case.`;
}

/** Only the live holder may release, and releasing an unheld case is not an error. */
export function canRelease(
  claim: CaseClaim | null,
  reviewerId: string,
  now: IsoDateTime,
): boolean {
  return canWrite(claim, reviewerId, now);
}

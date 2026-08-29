/**
 * One case, one reviewer.
 *
 * CLAUDE.md says two reviewers opening the same case is the central conflict
 * this app exists to resolve. This is the arbitration, as a pure function over
 * the current claim and who is asking — so the interesting case, losing the
 * race, is a VALUE the screen can render rather than an exception somebody has
 * to remember to catch.
 *
 * The Durable Object in Cluster D replaces the store behind this, not this.
 * `idFromName(caseId)` gives the serialisation that makes the check-then-write
 * below atomic; until then the window between reading a claim and writing one
 * is real and small, and the honest thing is to say so rather than to pretend
 * a file lock is a lease.
 */
import type { IsoDateTime } from "@/lib/schemas";

export interface CaseClaim {
  readonly reviewerId: string;
  /** Shown on screen, so a colleague is named rather than identified by id. */
  readonly displayName: string;
  readonly heldSince: IsoDateTime;
}

export type ClaimOutcome =
  /** Nobody held it, or the previous holder released it. It is yours now. */
  | { readonly kind: "granted"; readonly claim: CaseClaim }
  /** You already hold it. Not an error, and not a new claim either. */
  | { readonly kind: "already_yours"; readonly claim: CaseClaim }
  /** Somebody else holds it. This is the screen worth designing. */
  | { readonly kind: "held_by_other"; readonly claim: CaseClaim };

export interface ClaimRequest {
  readonly current: CaseClaim | null;
  readonly reviewerId: string;
  readonly displayName: string;
  /** Passed in rather than read from the clock, so this stays pure. */
  readonly now: IsoDateTime;
}

/**
 * Who ends up holding the case.
 *
 * There is deliberately no expiry and no steal. A claim that lapsed after an
 * hour would let two reviewers rule on one case during a long lunch, and the
 * whole point of the claim is that this cannot happen quietly. Releasing is
 * explicit, and a stuck claim is a conversation between two people rather than
 * a timeout — which is what it would be in the real organisation too.
 */
export function claimOutcome(request: ClaimRequest): ClaimOutcome {
  const { current, reviewerId, displayName, now } = request;

  if (current === null) {
    return {
      kind: "granted",
      claim: { reviewerId, displayName, heldSince: now },
    };
  }

  if (current.reviewerId === reviewerId) {
    // Held since when they FIRST claimed it, not now. Re-pressing a button
    // must not quietly reset how long they have had it, because that number is
    // what a colleague uses to decide whether to interrupt them.
    return { kind: "already_yours", claim: current };
  }

  return { kind: "held_by_other", claim: current };
}

/** Whether this reviewer may write to the case at all. */
export function canWrite(
  claim: CaseClaim | null,
  reviewerId: string,
): boolean {
  return claim !== null && claim.reviewerId === reviewerId;
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
): string | null {
  if (claim === null) return "Claim this case first.";
  if (claim.reviewerId === reviewerId) return null;
  return `${claim.displayName} has this case.`;
}

/** Only the holder may release, and releasing an unheld case is not an error. */
export function canRelease(
  claim: CaseClaim | null,
  reviewerId: string,
): boolean {
  return claim !== null && claim.reviewerId === reviewerId;
}

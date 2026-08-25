import { z } from "zod";
import { CaseId, IsoDateTime, ReviewerId } from "./primitives";

/**
 * Who is holding a case right now.
 *
 * CLAUDE.md names this the central conflict the app exists to resolve: "Many
 * people share [the reviewer role]. Two reviewers opening the same case is the
 * central conflict this app exists to resolve." So a claim is a first-class
 * entity with its own schema, not a boolean on the Case.
 *
 * A CLAIM EXPIRES, AND THAT IS THE INTERESTING PART.
 *
 * Without a lapse, "one case, one reviewer" becomes "one case, one reviewer,
 * forever" — somebody opens a case at 16:55 on Friday, closes the laptop, and
 * a serious unlisted report with a 15-day clock is locked until they come
 * back. Every real system that has tried a permanent lock has grown an admin
 * screen for breaking them; the lapse is that screen, minus the screen.
 *
 * The reverse failure matters too, which is why the window is not short: a
 * reviewer reading a forty-page CCDS is doing exactly what the app is for, and
 * having the case stolen out from under them at the five-minute mark is worse
 * than a stale lock. Refreshing is cheap — re-claiming your own case extends
 * it — so the ceiling only bites when somebody has genuinely walked away.
 */
export const CLAIM_TTL_MINUTES = 30;

export const CaseClaim = z.object({
  caseId: CaseId,
  reviewerId: ReviewerId,
  /** Shown to the reviewer who is refused, so the answer is a person. */
  displayName: z.string().min(1).max(120),
  claimedAt: IsoDateTime,
  /**
   * When this claim stops being honoured. Stored rather than derived: the TTL
   * constant can change with a deploy, and a claim taken under the old one
   * should keep the window it was granted, not silently gain or lose time.
   */
  expiresAt: IsoDateTime,
});
export type CaseClaim = z.output<typeof CaseClaim>;

/**
 * What happened when somebody asked for a case.
 *
 * `refused` carries the holder, because "someone else has it" is not an
 * actionable message and "Dr Osei has it until 16:40" is.
 */
export const ClaimOutcome = z.discriminatedUnion("status", [
  z.object({ status: z.literal("granted"), claim: CaseClaim }),
  z.object({ status: z.literal("refreshed"), claim: CaseClaim }),
  z.object({ status: z.literal("refused"), heldBy: CaseClaim }),
]);
export type ClaimOutcome = z.output<typeof ClaimOutcome>;

export function claimIsLive(claim: CaseClaim, now: string): boolean {
  return claim.expiresAt > now;
}

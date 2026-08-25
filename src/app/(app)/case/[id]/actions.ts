"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getCaseCoordination } from "@/lib/coordinator";
import { CACHE_KEY, getCache } from "@/lib/cache/kv";
import {
  ReviewerRuling,
  anyReactionSerious,
  expeditedDeadline,
} from "@/lib/schemas";
import { getCaseStore } from "@/lib/store/case-store";
import type { ClaimOutcome } from "@/lib/schemas/claim";

/**
 * Claiming and ruling — the two writes that decide a case.
 *
 * Both go through the Durable Object rather than through D1, and the split is
 * deliberate: the DO is the AUTHORITY on who holds a case and what they
 * decided, and D1 is the queryable mirror. Writing the ruling to D1 first and
 * the DO second would let a reviewer who does not hold the case leave a
 * ruling in the table, which is the exact failure the coordinator exists to
 * prevent.
 *
 * Every one of these requires a session. `requireSession()` throws rather than
 * returning null, so a caller cannot forget the check — the (app) route group
 * already gates the pages, but a Server Action is reachable directly by POST
 * and is not covered by a layout.
 */

export interface ClaimResult {
  readonly outcome: ClaimOutcome;
}

export async function claimCaseAction(caseId: string): Promise<ClaimResult> {
  const session = await requireSession();
  const coordination = await getCaseCoordination();

  const outcome = await coordination.claim(
    caseId,
    session.reviewerId,
    session.displayName,
  );

  revalidatePath(`/case/${caseId}`);
  return { outcome };
}

export async function releaseCaseAction(caseId: string): Promise<void> {
  const session = await requireSession();
  const coordination = await getCaseCoordination();
  await coordination.release(caseId, session.reviewerId);
  revalidatePath(`/case/${caseId}`);
}

export interface RuleResult {
  readonly ok: boolean;
  readonly message: string | null;
}

/**
 * Record the reviewer's decision.
 *
 * The rationale is required by the schema, not by this function — an
 * unexplained override is not an audit trail, and making the requirement part
 * of ReviewerRuling means the client form and this action enforce it from one
 * definition (non-negotiable #2).
 *
 * `decidedBy` is taken from the SESSION and never from the form. A field the
 * client supplies is a field the client chooses, and "who ruled on this case"
 * is not a client's choice to make.
 */
export async function ruleCaseAction(
  caseId: string,
  input: { listedness: string; expectedness: string; rationale: string },
): Promise<RuleResult> {
  const session = await requireSession();

  const parsed = ReviewerRuling.safeParse({
    listedness: input.listedness,
    expectedness: input.expectedness,
    rationale: input.rationale.trim(),
    decidedBy: session.reviewerId,
    decidedAt: new Date().toISOString(),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "That ruling is not complete. Say what you decided and why.",
    };
  }

  const coordination = await getCaseCoordination();
  const result = await coordination.rule(caseId, parsed.data);

  if (result.ok) {
    // THE RULING IS WHAT STARTS THE CLOCK.
    //
    // CLAUDE.md: "Serious + unlisted starts a 15-day expedited clock from the
    // day the company first received the report (Day 0)." Both halves of that
    // condition are only settled here — seriousness comes from the reactions
    // on the case, and listedness is not known until a human says so, because
    // the model never decides. So this is the earliest honest moment to arm
    // the alarm, and Day 0 is still `receivedAt`, not today: ruling late does
    // not buy back the days.
    await armExpeditedClock(caseId, parsed.data.listedness === "unlisted");

    // The queue shows each case's standing determination, so a ruling changes
    // it. Dropped rather than left to expire: a reviewer who rules and then
    // looks at the queue must see their own decision, and "wait sixty seconds"
    // is not an answer.
    const cache = await getCache();
    await cache.drop(CACHE_KEY.triageQueue);
    revalidatePath("/queue");
  }

  revalidatePath(`/case/${caseId}`);
  return { ok: result.ok, message: result.reason };
}

/**
 * Arm or stand down the 15-day alarm for one case.
 *
 * Standing it DOWN matters as much as arming it. A reviewer who rules
 * "unlisted" and then corrects themselves to "listed" has removed the
 * obligation, and an alarm left armed would report a missed deadline for a
 * case that never had one — which in a log that gets read during an inspection
 * is worse than no alarm at all.
 */
async function armExpeditedClock(
  caseId: string,
  isUnlisted: boolean,
): Promise<void> {
  const store = await getCaseStore();
  const record = await store.get(caseId);
  if (record === null) return;

  const applies = isUnlisted && anyReactionSerious(record.reactions);
  const coordination = await getCaseCoordination();

  await coordination.armClock(
    caseId,
    record.reference,
    applies ? expeditedDeadline(record.receivedAt) : null,
  );
}

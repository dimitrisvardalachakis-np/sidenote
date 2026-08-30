"use client";

import { useActionState } from "react";
import type { CaseClaim } from "@/lib/case/claim";
import {
  INITIAL_CLAIM_STATE,
  type ClaimActionState,
} from "@/app/(app)/case/[id]/ruling-state";

/**
 * "Is somebody else on this?"
 *
 * A reviewer's real first question when opening a case, and until now the
 * interface never asked it — the whole conflict was one sentence of body text
 * saying claiming would arrive later.
 *
 * Three states, and the third is the one worth designing. Unclaimed offers the
 * claim. Held by you says since when, and offers to put it down. Held by
 * somebody else names them, says since when, and says plainly what you can
 * still do — because a reviewer who can read everything and rule on nothing
 * needs to be told that, not left to discover it by pressing dead controls.
 *
 * Nothing here uses --signal. A colleague holding a case is not a deadline.
 */
export function ClaimPanel({
  claim,
  reviewerId,
  claimAction,
  releaseAction,
}: {
  claim: CaseClaim | null;
  reviewerId: string;
  claimAction: (state: ClaimActionState) => Promise<ClaimActionState>;
  releaseAction: (state: ClaimActionState) => Promise<ClaimActionState>;
}) {
  const [claimState, submitClaim, claiming] = useActionState(
    claimAction,
    INITIAL_CLAIM_STATE,
  );
  const [, submitRelease, releasing] = useActionState(
    releaseAction,
    INITIAL_CLAIM_STATE,
  );

  const mine = claim !== null && claim.reviewerId === reviewerId;
  const theirs = claim !== null && claim.reviewerId !== reviewerId;

  if (theirs) {
    return (
      <div className="rounded-card border border-rule border-l-[3px] border-l-ink bg-surface px-4 py-3 shadow-card">
        <p className="text-base">
          Held by <span className="font-medium">{claim.displayName}</span> since{" "}
          <span className="font-mono tabular-nums">{timeOf(claim.heldSince)}</span>
        </p>
        <p className="mt-1 text-meta text-slate">
          You can read everything on this case, including the evidence and the
          documents behind it. You cannot claim it, rule on it, or change a
          seriousness flag while {claim.displayName} holds it.
        </p>
        {/*
          The lost-race message, rendered in place rather than as a thrown
          error. Only shown after an actual attempt.
        */}
        {claimState.status === "held_by_other" && claimState.message !== null && (
          <p role="status" className="mt-1.5 text-meta text-ink">
            {claimState.message}
          </p>
        )}
      </div>
    );
  }

  if (mine) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-soft bg-steady-wash px-4 py-2.5">
        <p className="text-base text-steady">
          You have this case since{" "}
          <span className="font-mono tabular-nums">
            {timeOf(claim.heldSince)}
          </span>
        </p>
        <form action={submitRelease}>
          <button
            type="submit"
            disabled={releasing}
            className="min-h-8 cursor-pointer rounded-soft border border-steady-line bg-surface px-3 py-1 text-meta text-steady hover:border-steady disabled:opacity-40"
          >
            {releasing ? "Releasing…" : "Release"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={submitClaim} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={claiming}
        className="min-h-10 cursor-pointer rounded-soft bg-steady px-4 py-2 text-base font-medium text-surface hover:opacity-90 disabled:opacity-40"
      >
        {claiming ? "Claiming…" : "Claim this case"}
      </button>
      <p className="text-meta text-slate">
        Nobody has this case. Claiming it lets you record a ruling and tells
        your colleagues you are on it.
      </p>
    </form>
  );
}

/** HH:MM from an ISO timestamp, or the date when it was not today. */
function timeOf(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today
    ? iso.slice(11, 16)
    : iso.slice(0, 16).replace("T", " ");
}

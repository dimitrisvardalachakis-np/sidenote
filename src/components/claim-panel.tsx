"use client";

import { useActionState } from "react";
import { IdempotentForm } from "@/components/idempotent-form";
import { formatDateTime } from "@/lib/format/datetime";
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
 *
 * `arbitrated` is the fourth thing this panel says, and it is the one the
 * reviewer cannot find out any other way. Three comments in the coordinator
 * claimed the screen already said it; none of them did. The stand-in behind
 * `next dev` arbitrates perfectly between two tabs on one laptop and not at
 * all between two reviewers on two machines — and without this line the panel
 * looks identical either way, which is exactly the failure the class is named
 * `UnarbitratedCoordination` to avoid.
 */
export function ClaimPanel({
  claim,
  reviewerId,
  arbitrated,
  claimAction,
  releaseAction,
}: {
  claim: CaseClaim | null;
  reviewerId: string;
  /** False when an in-process stand-in is deciding this, not a Durable Object. */
  arbitrated: boolean;
  claimAction: (
    state: ClaimActionState,
    formData: FormData,
  ) => Promise<ClaimActionState>;
  releaseAction: (
    state: ClaimActionState,
    formData: FormData,
  ) => Promise<ClaimActionState>;
}) {
  const [claimState, submitClaim, claiming] = useActionState(
    claimAction,
    INITIAL_CLAIM_STATE,
  );
  const [releaseState, submitRelease, releasing] = useActionState(
    releaseAction,
    INITIAL_CLAIM_STATE,
  );

  const mine = claim !== null && claim.reviewerId === reviewerId;
  const theirs = claim !== null && claim.reviewerId !== reviewerId;

  /*
    WHAT CHANGED, for somebody who cannot see the panel change.

    Derived from the ACTION state and never from `claim`, and that is the whole
    correctness of it. `claim` says who holds the case, which is equally true
    on a first render as after a press — announcing from it would read the
    holder aloud every time the page loaded, which is narration rather than
    news. The action state is only ever set by something this reviewer just
    did.
  */
  const announcement =
    claimState.status === "granted"
      ? "You now hold this case. You can record a ruling."
      : claimState.status === "held_by_other"
        ? claimState.message ?? "Somebody else claimed this case first."
        : claimState.status === "already_yours"
          ? "You already hold this case."
          : releaseState.status === "released"
            ? "Released. Anybody can claim this case now."
            : "";

  /*
    The three panels below replace one another, so the live region cannot live
    inside any of them: an element that appears at the same moment as its text
    is inserted, not updated, and assistive technology routinely misses it. It
    is rendered here, unconditionally and empty, in a fixed position — so every
    branch below is a change to a region that was already there.

    This is also why the audit's probe found nothing. `role="status"` carries an
    implicit `aria-live="polite"`, so the attribute selector returned zero on
    pages that did have live regions; what it could not see is that they were
    all conditional. Both are stated now: the role for meaning, the attribute so
    the next person auditing this finds it.
  */
  const announcer = (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </p>
  );

  if (theirs) {
    return (
      <>
        {announcer}
        <div className="rounded-card border border-rule border-l-[3px] border-l-ink bg-surface px-4 py-3 shadow-card">
          <p className="text-base">
            Held by <span className="font-medium">{claim.displayName}</span> since{" "}
            <span className="font-mono tabular-nums">
              {formatDateTime(claim.heldSince)}
            </span>
          </p>
          <p className="mt-1 text-meta text-slate">
            You can read everything on this case, including the evidence and the
            documents behind it. You cannot claim it, rule on it, or change a
            seriousness flag while {claim.displayName} holds it.
          </p>
          {/*
            The lost-race message, rendered in place rather than as a thrown
            error. Only shown after an actual attempt — which is exactly why the
            `role` lives on the announcer above and not here: an element that
            arrives already carrying its text is inserted, not updated, and does
            not announce.
          */}
          {claimState.status === "held_by_other" && claimState.message !== null && (
            <p className="mt-1.5 text-meta text-ink">{claimState.message}</p>
          )}
        </div>
      </>
    );
  }

  if (mine) {
    return (
      <>
        {announcer}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-soft bg-steady-wash px-4 py-2.5">
          <p className="text-base text-steady">
            You have this case since{" "}
            <span className="font-mono tabular-nums">
              {formatDateTime(claim.heldSince)}
            </span>
          </p>
          {!arbitrated && (
            <p className="w-full text-meta text-slate">
              Held in this process only — not across machines.
            </p>
          )}
          <IdempotentForm action={submitRelease}>
            <button
              type="submit"
              disabled={releasing}
              className="min-h-8 cursor-pointer rounded-soft border border-steady-line bg-surface px-3 py-1 text-meta text-steady hover:border-steady disabled:opacity-40"
            >
              {releasing ? "Releasing…" : "Release"}
            </button>
          </IdempotentForm>
        </div>
      </>
    );
  }

  return (
    <>
      {announcer}
      <IdempotentForm
        action={submitClaim}
        className="flex flex-wrap items-center gap-3"
      >
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
          {!arbitrated && (
            <>
              {" "}
              <span className="text-slate">
                Claims are held in this process only, so they do not hold across
                machines — no Durable Object is bound here.
              </span>
            </>
          )}
        </p>
      </IdempotentForm>
    </>
  );
}


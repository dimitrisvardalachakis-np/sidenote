/**
 * The result of trying to record a ruling.
 *
 * Its own module because a `"use server"` file may only export async
 * functions, and `useActionState` needs the shape on the client.
 */
export interface RulingState {
  readonly status: "idle" | "recorded" | "rejected";
  /** Why it was refused, in words the reviewer can act on. Null when fine. */
  readonly error: string | null;
}

export const INITIAL_RULING_STATE: RulingState = {
  status: "idle",
  error: null,
};

export interface ClaimActionState {
  readonly status: "idle" | "granted" | "already_yours" | "held_by_other" | "released";
  readonly message: string | null;
}

export const INITIAL_CLAIM_STATE: ClaimActionState = {
  status: "idle",
  message: null,
};
export const IDEMPOTENCY_FIELD = "idempotencyKey";

/**
 * What an assessment run did, so the screen can say so.
 *
 * `runAssessment` returned void, which is fine for a form action that only
 * needs to revalidate — and is why the run finished in silence. A reviewer
 * watching the page sees panels change; a reviewer using a screen reader was
 * told nothing at all, on the one control that spends money and rewrites the
 * evidence.
 *
 * `message` is a SUMMARY OF WHAT THE DOCUMENTS SAY, never a determination.
 * `documentStance` is the same function the panels render from, so the
 * announcement cannot drift into claiming something the screen does not show,
 * and it reaches no verdict about listedness — non-negotiable #4 holds here
 * exactly as it does everywhere else.
 */
export interface AssessActionState {
  readonly status: "idle" | "assessed" | "skipped";
  readonly message: string | null;
}

export const INITIAL_ASSESS_STATE: AssessActionState = {
  status: "idle",
  message: null,
};

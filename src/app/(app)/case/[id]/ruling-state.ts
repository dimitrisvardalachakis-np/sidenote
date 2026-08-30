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

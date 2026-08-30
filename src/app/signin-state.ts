/**
 * The sign-in form's state, in its own module.
 *
 * A `"use server"` file may only export async functions, so the initial state
 * object cannot live beside the action that consumes it. Same arrangement as
 * `case/[id]/ruling-state.ts`, and the same reason.
 */
export interface SignInState {
  readonly status: "idle" | "rejected";
  /** Shown on the form. Never says which half was wrong. */
  readonly error: string | null;
}

export const INITIAL_SIGN_IN_STATE: SignInState = {
  status: "idle",
  error: null,
};

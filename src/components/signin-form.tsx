"use client";

import { useActionState, useId, useRef } from "react";
import { signIn } from "@/app/session-actions";
import { INITIAL_SIGN_IN_STATE } from "@/app/signin-state";

/**
 * The reviewer's credentials, in the two places they are asked for.
 *
 * One component, imported by `/signin` and by the landing page's role panel,
 * because two copies of a login form is two places for the honesty line to
 * drift — and that line is the point. This build has ONE shared password. The
 * email chooses which of three shared identities you wear; the password says
 * you may wear one. That is a real gate and it is not per-person
 * authentication, and a password field on its own would quietly imply the
 * second. So the form says which it is, in a sentence, under the button.
 *
 * `useActionState` rather than a plain action, so a wrong password re-renders
 * this form with a message instead of navigating somewhere to say so. The
 * success path never returns — `signIn` redirects — so there is no "signed in"
 * state to render here.
 */
export function SignInForm({
  submitLabel,
  identities,
}: {
  submitLabel: string;
  /**
   * The demo identities, listed when there is room for them. They FILL THE
   * FIELD and do not sign anyone in: a control that adopted an identity
   * without the password would walk straight around the gate this form exists
   * to be.
   */
  identities?: readonly { id: string; displayName: string; email: string }[];
}) {
  const [state, submit, pending] = useActionState(signIn, INITIAL_SIGN_IN_STATE);
  const emailRef = useRef<HTMLInputElement>(null);
  const id = useId();

  return (
    <form action={submit}>
      <label
        htmlFor={`${id}-email`}
        className="block text-base font-medium text-ink"
      >
        Work email
      </label>
      <input
        id={`${id}-email`}
        ref={emailRef}
        name="email"
        type="email"
        autoComplete="username"
        placeholder="name@company.com"
        className="mt-1.5 min-h-11 w-full rounded-soft border border-rule bg-surface px-3 py-2 text-base placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
      />

      <label
        htmlFor={`${id}-password`}
        className="mt-4 block text-base font-medium text-ink"
      >
        Password
      </label>
      <input
        id={`${id}-password`}
        name="password"
        type="password"
        autoComplete="current-password"
        className="mt-1.5 min-h-11 w-full rounded-soft border border-rule bg-surface px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 focus:outline-steady"
      />

      {/*
        The failure, above the button rather than below it — the eye is on the
        control it just pressed. `role="alert"` because it appears after an
        action rather than being on the page from the start.
      */}
      {state.error !== null && (
        <p
          role="alert"
          className="mt-4 rounded-soft border-l-[3px] border-ink bg-surface-sunken px-3 py-2 text-base text-ink"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 min-h-11 w-full cursor-pointer rounded-soft bg-steady px-4 py-2 text-base font-medium text-surface hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in…" : submitLabel}
      </button>

      {/*
        What the password actually is. Non-negotiable in spirit: a login form
        is a claim about security, and this one must not be read as more than
        it is.
      */}
      <p className="mt-3 text-meta text-slate">
        One shared password for this training build — it is checked, but it is
        not per-person authentication. The address decides which identity the
        audit line records.
      </p>

      {identities !== undefined && (
        <div className="mt-5 border-t border-rule pt-4">
          <p className="text-micro font-mono uppercase tracking-label text-slate">
            Demo identities
          </p>
          <p className="mt-1.5 text-meta text-slate">
            Three shared identities, so a case held by a colleague can be seen
            from both sides. Choosing one fills the address above; the password
            is still required.
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {identities.map((reviewer) => (
              <li key={reviewer.id}>
                <button
                  type="button"
                  onClick={() => {
                    const field = emailRef.current;
                    if (field === null) return;
                    field.value = reviewer.email;
                    field.focus();
                  }}
                  className="min-h-8 cursor-pointer rounded-pill border border-rule px-3 py-1 text-meta text-slate hover:border-steady-line hover:text-steady"
                >
                  {reviewer.displayName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

"use client";

import { useRef, type ReactNode } from "react";
import { IDEMPOTENCY_FIELD } from "@/app/(app)/case/[id]/ruling-state";

/**
 * A form that carries one idempotency key per submission attempt.
 *
 * WHAT THIS IS ACTUALLY GUARDING AGAINST, because it decides the design.
 *
 * Not a reviewer pressing Claim twice a minute apart — that is two intents and
 * should be two requests. The duplicate that matters is ONE submission
 * arriving twice: the browser retrying a Server Action over a flaky
 * connection, a client that timed out and resent, a double-click landing
 * before the button disables. All three replay the same FormData, so a key
 * stamped at submit time is the same key on the retry, and the coordinator
 * returns the first result rather than ruling a second time.
 *
 * STAMPED ON SUBMIT, NOT AT RENDER. A value randomised during render differs
 * between server and client and breaks hydration; a value fixed for the life
 * of the component goes stale, so claiming, releasing and claiming again would
 * send the second claim under the first one's key and be handed back the first
 * one's answer. Filling it in the submit handler avoids both: the field is
 * empty in the markup and fresh for every genuine attempt.
 *
 * `onSubmit` still fires for a form with a React `action`, and it runs before
 * the action does, which is the whole reason this works.
 */
export function IdempotentForm({
  action,
  children,
  className,
}: {
  readonly action: (formData: FormData) => void;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const keyRef = useRef<HTMLInputElement | null>(null);

  return (
    <form
      action={action}
      className={className}
      onSubmit={() => {
        const field = keyRef.current;
        if (field === null) return;
        /*
          crypto.randomUUID needs a secure context. Every browser this runs in
          has one (localhost counts), but the fallback keeps a submit working
          rather than throwing on one that does not: a missing key costs
          idempotency, and losing the submission to protect it is the wrong
          trade in an app where the submission may be a regulatory ruling.
        */
        field.value =
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }}
    >
      <input ref={keyRef} type="hidden" name={IDEMPOTENCY_FIELD} />
      {children}
    </form>
  );
}

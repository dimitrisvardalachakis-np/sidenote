"use client";

import { useActionState } from "react";
import {
  INITIAL_ASSESS_STATE,
  type AssessActionState,
} from "@/app/(app)/case/[id]/ruling-state";

/**
 * "Assess this case", and the sentence saying what it did.
 *
 * A client component for one reason: the announcement has to distinguish
 * "you just ran this" from "this case was assessed last Tuesday". A server
 * component cannot — it renders the same tree either way, so anything derived
 * from the stored assessment would be read aloud on every page load, which is
 * narration rather than news. `useActionState` holds the result of THIS
 * reviewer's press and nothing else.
 *
 * The region is mounted always and empty, above the control rather than after
 * it. An element that appears at the same moment as its text is an insertion,
 * not an update, and does not announce — which is why the assessment, the one
 * control on this screen that spends money and rewrites the evidence panels,
 * finished in silence.
 *
 * Visually it is one quiet line in the same register as the button. A sighted
 * reviewer had no confirmation either: the button re-rendered and the panels
 * below changed, with nothing saying the run had finished rather than failed.
 */
export function AssessControl({
  caseId,
  assessed,
  disabled,
  title,
  action,
}: {
  caseId: string;
  /** Whether an assessment already exists, which is what the label says. */
  assessed: boolean;
  disabled: boolean;
  title: string;
  action: (
    state: AssessActionState,
    formData: FormData,
  ) => Promise<AssessActionState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL_ASSESS_STATE);

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="order-2 basis-full text-right text-meta text-slate"
      >
        {pending
          ? "Searching the safety documents…"
          : (state.message ?? "")}
      </p>

      <form action={submit} className="order-1">
        {/*
          The case id travels in the form rather than through `bind`, so this
          stays one component whatever the route does with its params.
        */}
        <input type="hidden" name="caseId" value={caseId} />
        <button
          type="submit"
          disabled={disabled || pending}
          title={title}
          className="min-h-8 cursor-pointer rounded-soft border border-rule bg-surface px-3 py-1 font-mono text-micro uppercase tracking-label text-slate hover:border-steady-line hover:text-steady disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Assessing…" : assessed ? "Re-assess" : "Assess this case"}
        </button>
      </form>
    </div>
  );
}

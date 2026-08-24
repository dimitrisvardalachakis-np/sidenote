"use client";

import { useSyncExternalStore } from "react";
import { StepAbout } from "./step-about";
import {
  readDraft,
  readServerDraft,
  subscribeToDraft,
  writeDraft,
} from "@/lib/report-draft-store";
import {
  STEP_IDS,
  STEP_TITLES,
  stepProgress,
  type ReportDraft,
  type StepId,
} from "@/lib/schemas/report";
import { isAnswered } from "@/lib/schemas/answer";

/**
 * The five-step form.
 *
 * State lives in sessionStorage and is read through useSyncExternalStore, so a
 * refresh keeps both the answers and the step the reporter had reached. See
 * report-draft-store.ts for why that hook rather than useState.
 *
 * The step is held in state rather than the URL deliberately. Browser back
 * inside a wizard usually means "undo my last answer", but on a URL-driven
 * wizard it means "leave the form", and people lose their work to it. Back and
 * Next are on the page where they can be seen.
 */
export function ReportWizard() {
  const saved = useSyncExternalStore(
    subscribeToDraft,
    readDraft,
    readServerDraft,
  );
  const { draft, stepIndex } = saved;
  const stepId: StepId = STEP_IDS[stepIndex] ?? "about";

  const update = (patch: Partial<ReportDraft>) => {
    writeDraft({ draft: { ...draft, ...patch }, stepIndex });
  };

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), STEP_IDS.length - 1);
    writeDraft({ draft, stepIndex: clamped });
    // Send focus to the heading so a keyboard or screen reader user is told
    // the step changed, instead of being left at the bottom of the old one.
    requestAnimationFrame(() => {
      document.getElementById("step-heading")?.focus();
    });
  };

  const canLeaveFirstStep = isAnswered(draft.about);
  const progress = stepProgress(draft, stepId);

  return (
    <div>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 border-y border-rule py-2">
        {STEP_IDS.map((id, index) => {
          const current = index === stepIndex;
          const done = stepProgress(draft, id).resolved > 0;
          return (
            <li key={id}>
              <span
                aria-current={current ? "step" : undefined}
                className={[
                  "text-micro uppercase tracking-label",
                  current
                    ? "text-steady"
                    : done
                      ? "text-ink"
                      : "text-slate",
                ].join(" ")}
              >
                {index + 1}. {STEP_TITLES[id]}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4">
        <h2
          id="step-heading"
          tabIndex={-1}
          className="text-title font-medium focus:outline-2 focus:outline-offset-2 focus:outline-steady"
        >
          {STEP_TITLES[stepId]}
        </h2>
        <p className="mt-1 text-meta text-slate">
          Step {stepIndex + 1} of {STEP_IDS.length}. {progress.resolved} of{" "}
          {progress.total} questions answered on this step.
        </p>
      </div>

      <div className="mt-4">
        {stepId === "about" ? (
          <StepAbout draft={draft} update={update} />
        ) : (
          <div className="border border-rule p-3 rounded-soft">
            <p className="text-micro uppercase tracking-label text-slate">
              Not built yet
            </p>
            <p className="mt-1 text-base">
              This step is next. Step 1 and the shared checks were built first
              so the shape could be agreed before the rest went on top.
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-rule pt-4">
        <button
          type="button"
          onClick={() => goTo(stepIndex - 1)}
          disabled={stepIndex === 0}
          className="cursor-pointer rounded-soft border border-rule px-4 py-2 text-base hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back
        </button>

        <button
          type="button"
          onClick={() => goTo(stepIndex + 1)}
          disabled={stepIndex === 0 && !canLeaveFirstStep}
          className="cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {stepIndex === 0 && !canLeaveFirstStep && (
        <p className="mt-2 text-meta text-slate">
          Choose who this is about to carry on.
        </p>
      )}

      <p className="mt-6 text-meta text-slate">
        Your answers are kept in this browser tab as you go, so a refresh will
        not lose them. Closing the tab clears them.
      </p>
    </div>
  );
}

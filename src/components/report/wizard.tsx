"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { StepAbout } from "./step-about";
import { StepWhatHappened } from "./step-what-happened";
import { StepHospital } from "./step-hospital";
import { StepMedicine } from "./step-medicine";
import { StepYou } from "./step-you";
import { submitReportAction } from "@/app/report/submit-action";
import type { SubmitOutcome } from "@/lib/report/submit";
import {
  clearDraft,
  readDraft,
  readServerDraft,
  subscribeToDraft,
  writeDraft,
} from "@/lib/report-draft-store";
import {
  MISSING_MESSAGES,
  STEP_IDS,
  STEP_TITLES,
  missingElements,
  stepProgress,
  type ReportDraft,
  type StepId,
} from "@/lib/schemas/report";
import { isAnswered } from "@/lib/schemas/answer";

/**
 * The five-step form.
 *
 * Answers live in sessionStorage and are read through useSyncExternalStore, so
 * a refresh keeps both the answers and the step. See report-draft-store.ts for
 * why that hook rather than useState plus an effect.
 *
 * The step is held in storage rather than the URL deliberately. Browser back
 * inside a wizard usually means "undo my last answer", but on a URL-driven
 * wizard it means "leave the form", and people lose their work to it. Back and
 * Next are on the page where they can be seen and reached by keyboard.
 */
export function ReportWizard() {
  const saved = useSyncExternalStore(
    subscribeToDraft,
    readDraft,
    readServerDraft,
  );
  const { draft, stepIndex, submitted } = saved;
  const stepId: StepId = STEP_IDS[stepIndex] ?? "about";

  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [sending, setSending] = useState(false);

  const update = (patch: Partial<ReportDraft>) => {
    writeDraft({ ...saved, draft: { ...draft, ...patch } });
  };

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), STEP_IDS.length - 1);
    writeDraft({ ...saved, stepIndex: clamped });
    // Move focus to the heading so a keyboard or screen reader user is told
    // the step changed, rather than being left at the bottom of the old one.
    requestAnimationFrame(() => {
      document.getElementById("step-heading")?.focus();
    });
  };

  async function send() {
    setSending(true);
    try {
      // The client checks first so the reporter is not made to wait for a
      // round trip to be told something the page already knew. The server
      // checks again regardless; that is the check that counts.
      const result = await submitReportAction(draft);
      setOutcome(result);
      if (result.status === "created") {
        writeDraft({
          ...saved,
          submitted: { reference: result.reference, caseId: result.caseId },
        });
      }
    } finally {
      setSending(false);
    }
  }

  // ---------------------------------------------------------------- sent
  if (submitted !== null) {
    return (
      <div>
        <h2 className="text-title font-medium">Thank you. Your report is in.</h2>
        <p className="mt-2 text-prose">
          A trained person reads every report. You do not need to do anything
          else.
        </p>

        <div className="mt-5 rounded-soft border border-rule p-4">
          <p className="text-micro uppercase tracking-label text-slate">
            Your reference number
          </p>
          <p className="mt-1 font-mono text-figure">{submitted.reference}</p>
          <p className="mt-3 text-prose">
            Please write this down or take a picture of it. Say this number if
            you ever contact us about this report.
          </p>
        </div>

        <p className="mt-5 text-meta text-slate">
          This is a training demo, so here is the reviewer view of what you just
          sent:{" "}
          <Link
            href={`/case/${submitted.caseId}`}
            className="text-steady hover:underline"
          >
            see the case
          </Link>
          . A real reporter would not have that link.
        </p>

        <button
          type="button"
          onClick={() => {
            clearDraft();
            setOutcome(null);
          }}
          className="mt-6 cursor-pointer rounded-soft border border-rule px-4 py-2 text-base hover:bg-row-hover"
        >
          Report something else
        </button>
      </div>
    );
  }

  const missing = missingElements(draft);
  const onLastStep = stepIndex === STEP_IDS.length - 1;
  const canLeaveFirstStep = isAnswered(draft.about);
  const progress = stepProgress(draft, stepId);

  return (
    <div>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 border-y border-rule py-2">
        {STEP_IDS.map((id, index) => {
          const current = index === stepIndex;
          const touched = stepProgress(draft, id).resolved > 0;
          return (
            <li key={id}>
              <span
                aria-current={current ? "step" : undefined}
                className={[
                  "text-micro uppercase tracking-label",
                  current ? "text-steady" : touched ? "text-ink" : "text-slate",
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
        {stepId === "about" && <StepAbout draft={draft} update={update} />}
        {stepId === "what_happened" && (
          <StepWhatHappened draft={draft} update={update} />
        )}
        {stepId === "hospital" && <StepHospital draft={draft} update={update} />}
        {stepId === "medicine" && <StepMedicine draft={draft} update={update} />}
        {stepId === "you" && <StepYou draft={draft} update={update} />}
      </div>

      {onLastStep && (
        <div className="mt-8 border-t border-rule pt-4">
          {missing.length > 0 && (
            <div
              role="alert"
              className="border-l-2 border-ink bg-row-hover px-3 py-2"
            >
              <p className="text-base font-medium">
                Before you send this, we still need{" "}
                {missing.length === 1 ? "one thing" : `${missing.length} things`}.
              </p>
              <ul className="mt-2">
                {missing.map((element) => (
                  <li key={element} className="mt-1 text-base">
                    {MISSING_MESSAGES[element]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outcome !== null && outcome.status !== "created" && (
            <div role="alert" className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2">
              <p className="text-base font-medium">We could not send it yet.</p>
              <ul className="mt-2">
                {(outcome.status === "failed"
                  ? [outcome.message]
                  : outcome.messages
                ).map((message) => (
                  <li key={message} className="mt-1 text-base">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || missing.length > 0}
            className="mt-4 cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending" : "Send my report"}
          </button>
          <p className="mt-2 text-meta text-slate">
            Nothing is sent until you press this.
          </p>
        </div>
      )}

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
          disabled={onLastStep || (stepIndex === 0 && !canLeaveFirstStep)}
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

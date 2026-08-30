"use client";


import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { StepAbout } from "./step-about";
import { StepWhatHappened } from "./step-what-happened";
import { StepStopping } from "./step-stopping";
import { StepMedicine } from "./step-medicine";
import { StepYou } from "./step-you";
import { SentConfirmation } from "./sent";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/protection/turnstile";
import { submitReportAction } from "@/app/(public)/report/submit-action";
import type { SubmitOutcome } from "@/lib/report/submit";
import {
  DRAFT_TTL_LABEL,
  clearDraft,
  readDraft,
  readServerDraft,
  subscribeToDraft,
  writeDraft,
} from "@/lib/report-draft-store";
import {
  MISSING_MESSAGES,
  OPTIONAL_STEPS,
  STEP_IDS,
  STEP_TITLES,
  formatProblems,
  missingElements,
  stepProgress,
  type ReportDraft,
  type StepId,
} from "@/lib/schemas/report";
import { isAnswered } from "@/lib/schemas/answer";
import { ProgressRule, RequiredChecklist } from "./orientation";

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
export function ReportWizard({ siteKey }: { readonly siteKey: string | null }) {
  /*
    The token lives with the wizard, not with the step that submits.

    Turnstile solves in the background while the reporter answers eight
    questions, so by the time they reach Send the challenge is long done. The
    widget is rendered on the final step only — a challenge on step one, four
    screens before anything is sent, would expire before it was used.
  */
  const turnstile = useTurnstile(siteKey);

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
      const result = await submitReportAction(draft, turnstile.token);
      setOutcome(result);
      // Single use: siteverify answers `timeout-or-duplicate` the second time
      // it sees a token, so a failed submit that reused this one would be
      // rejected as a robot rather than retried.
      turnstile.reset();
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
      <SentConfirmation
        reference={submitted.reference}
        caseId={submitted.caseId}
        medicineName={
          isAnswered(draft.medicineName) ? draft.medicineName.value : null
        }
        onReportAnother={() => {
          clearDraft();
          setOutcome(null);
        }}
      />
    );
  }

  const missing = missingElements(draft);
  /*
    Answers that are present but the wrong shape — a mistyped email address,
    an age of 700. Kept apart from `missing` and NOT shown in the alert box
    below: each one is already displayed beside the box it belongs to, once
    the reporter has left that box, and repeating it in a live region would
    announce "that email address does not look complete" on every keystroke of
    an email address being typed.

    It still has to stop Send, because the server refuses these too, and
    letting somebody press Send to be told is worse than not letting them.
  */
  const problems = formatProblems(draft);
  const onLastStep = stepIndex === STEP_IDS.length - 1;
  const canLeaveFirstStep = isAnswered(draft.about);
  const progress = stepProgress(draft, stepId);

  return (
    <div>
      {/*
        Everything from the checklist down lives in ONE card, so the form reads
        as a single object a reporter is working through rather than as five
        stacked panels. The draft notice and the way to clear it stay outside
        it, quietest on the page.
      */}
      <div className="rounded-card border border-rule bg-surface p-5 shadow-card sm:p-6">
        {/*
          Stacked below sm, side by side above it. Sharing one row on a phone
          gave the link its full 280px and left the checklist about sixty —
          "A report needs these four" wrapped over four lines and the pills
          under it went single-file.
        */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <RequiredChecklist missing={missing} />
          </div>
          {/*
            The way across, and it carries the answers. Crossing used to mean
            starting again from nothing, which made the first choice on the
            landing page unrecoverable.
          */}
          <Link
            href="/report/chat"
            className="text-meta text-steady hover:underline sm:shrink-0"
          >
            Answer one question at a time instead →
          </Link>
        </div>

        <div className="mt-6">
          <ProgressRule
            steps={STEP_IDS.map((id) => ({ id, title: STEP_TITLES[id] }))}
            current={stepIndex}
          />
        </div>

        <div className="mt-5">
          <h2
            id="step-heading"
            tabIndex={-1}
            className="text-[21px] leading-tight font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-steady"
          >
            {STEP_TITLES[stepId]}
            {OPTIONAL_STEPS[stepId] && (
              <span className="ml-2 text-body font-normal text-slate">
                optional
              </span>
            )}
          </h2>
          <p className="mt-1 text-meta text-slate">
            {progress.resolved} of {progress.total} questions answered here.
          </p>
        </div>

        <div className="mt-5">
          {stepId === "about" && <StepAbout draft={draft} update={update} />}
          {stepId === "what_happened" && (
            <StepWhatHappened draft={draft} update={update} />
          )}
          {stepId === "medicine" && (
            <StepMedicine draft={draft} update={update} />
          )}
          {stepId === "stopping" && (
            <StepStopping draft={draft} update={update} />
          )}
          {stepId === "you" && <StepYou draft={draft} update={update} />}
        </div>

        {onLastStep && (
          <div className="mt-8 border-t border-rule pt-5">
            {missing.length > 0 && (
              <div
                role="alert"
                className="rounded-card border border-rule border-l-[3px] border-l-ink bg-surface-sunken px-4 py-3"
              >
                <p className="text-body font-semibold">
                  Before you send this, we still need{" "}
                  {missing.length === 1
                    ? "one thing"
                    : `${missing.length} things`}
                  .
                </p>
                <ul className="mt-2">
                  {missing.map((element) => (
                    <li key={element} className="mt-1 text-body">
                      {MISSING_MESSAGES[element]}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {outcome !== null && outcome.status !== "created" && (
              <div
                role="alert"
                className="mt-3 rounded-card border border-rule border-l-[3px] border-l-ink bg-surface-sunken px-4 py-3"
              >
                <p className="text-body font-semibold">
                  We could not send it yet.
                </p>
                <ul className="mt-2">
                  {(outcome.status === "failed" || outcome.status === "blocked"
                    ? [outcome.message]
                    : outcome.messages
                  ).map((message: string) => (
                    <li key={message} className="mt-1 text-body">
                      {message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <TurnstileWidget
              status={turnstile.status}
              containerRef={turnstile.containerRef}
            />

            <button
              type="button"
              onClick={() => void send()}
              /*
                Not disabled on a missing token.

                The obvious wiring — require a solved token before Send is
                pressable — makes a Turnstile outage silently swallow adverse
                event reports, and the reporter is shown a dead button with no
                explanation. The server decides: guard.ts already separates
                "the challenge rejected you" from "the challenge did not run",
                and only the first is a refusal. So the button stays live and
                the answer comes back as a sentence.
              */
              disabled={sending || missing.length > 0 || problems.length > 0}
              className="mt-4 min-h-11 cursor-pointer rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? "Sending" : "Send my report"}
            </button>
            <p className="mt-2 text-meta text-slate">
              {problems.length > 0
                ? "One of your answers above needs another look before this can be sent."
                : "Nothing is sent until you press this."}
            </p>
          </div>
        )}

        {/*
          Back / Skip / Next pinned in a footer row INSIDE the card, so the
          controls that move the form belong to the form rather than floating
          under it.
        */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-rule pt-4">
          <button
            type="button"
            onClick={() => goTo(stepIndex - 1)}
            disabled={stepIndex === 0}
            className="min-h-11 cursor-pointer rounded-soft border border-rule px-4 py-2 text-body hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>

          <div className="flex items-center gap-3">
            {/*
              The explanation of a disabled Next, BESIDE the control rather
              than below it — where it was, under a button, out of the eye-line
              of the thing it explains.
            */}
            {stepIndex === 0 && !canLeaveFirstStep && (
              <p className="text-meta text-slate">
                Choose who this is about to carry on.
              </p>
            )}

            {/* An optional step says so, and offers the way past it. */}
            {OPTIONAL_STEPS[stepId] && !onLastStep && (
              <button
                type="button"
                onClick={() => goTo(stepIndex + 1)}
                className="min-h-11 cursor-pointer px-2 text-meta text-slate hover:text-steady hover:underline"
              >
                Skip this
              </button>
            )}

            <button
              type="button"
              onClick={() => goTo(stepIndex + 1)}
              disabled={onLastStep || (stepIndex === 0 && !canLeaveFirstStep)}
              className="min-h-11 cursor-pointer rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/*
        Says what is actually true now, and offers the way out.

        The old copy promised the tab clearing them, which sessionStorage did
        and localStorage does not. A privacy claim that has quietly stopped
        being true is worse than no claim, so this states the day and gives a
        control rather than relying on a browser behaviour.

        Outside the card and the quietest thing on the page: it is a standing
        fact about this device, not a step in the form.
      */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 px-1">
        <p className="text-meta text-slate-quiet">
          Your answers are kept on this device for {DRAFT_TTL_LABEL} so you can
          come back to them.
        </p>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "This will delete the answers you have given so far on this device. It cannot be undone.",
              )
            ) {
              clearDraft();
            }
          }}
          className="cursor-pointer text-meta text-slate-quiet hover:text-steady hover:underline"
        >
          Clear my answers
        </button>
      </div>
    </div>
  );
}

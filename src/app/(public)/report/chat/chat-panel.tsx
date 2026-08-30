"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { sendChatMessage } from "./actions";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/protection/turnstile";
import { initialChatState } from "./chat-state";
import {
  INTAKE_QUESTION_COUNT,
  remainingSlots,
  type IntakeMessage,
} from "@/lib/intake/conversation";
import type { Citation } from "@/lib/schemas";
import { draftFromSlots, slotsToCarry } from "@/lib/report/draft";
import {
  clearDraft,
  readDraft,
  subscribeToDraft,
  writeDraft,
} from "@/lib/report-draft-store";
import { RequiredChecklist } from "@/components/report/orientation";
import { missingElements } from "@/lib/schemas/report";
import { SentConfirmation } from "@/components/report/sent";
import { QuickAnswers } from "./quick-answers";
import { ReviewPanel } from "./review-panel";

/**
 * The slots in the order they are asked, so the checklist reads the same way
 * the conversation runs. `narrative` is not here: it is the opening turn and
 * is already answered by the time this list is visible.
 */
const SLOT_ORDER = [
  "drug",
  "reaction",
  "age",
  "sex",
  "seriousness",
  "reporterName",
  "reporterContact",
] as const;

/**
 * The form's answers as chat slots, JSON, with a stable reference.
 *
 * `useSyncExternalStore` re-renders forever if its snapshot is a fresh object
 * each call, so the string is cached against the draft it came from —
 * `readDraft` already returns a stable draft while the stored value is
 * unchanged, which makes identity the right key.
 */
let carriedCache: { draft: unknown; json: string } = { draft: null, json: "" };

function readCarriedSlots(): string {
  const saved = readDraft();
  // A sent report is a receipt, not an in-progress report. `slotsToCarry`
  // holds the reasoning and the test.
  const carried = slotsToCarry(saved);
  if (saved.draft !== carriedCache.draft) {
    carriedCache = {
      draft: saved.draft,
      json: carried === null ? "" : JSON.stringify(carried),
    };
  }
  return carriedCache.json;
}

const SLOT_LABELS: Readonly<Record<string, string>> = {
  drug: "the medicine",
  reaction: "what went wrong",
  age: "their age",
  sex: "male or female",
  seriousness: "how serious it was",
  reporterName: "your name",
  reporterContact: "how to reach you",
};

/**
 * A cited passage, shown inline in the conversation.
 *
 * This is non-negotiable #3 in the one place a member of the public sees it:
 * the assistant does not get to say "yes that is known" without showing the
 * words it read. Every citation here is `public` by construction — the Server
 * Action searches only the public namespace for this audience — and the badge
 * says so, because CLAUDE.md requires every retrieval result to state which.
 */
function CitedPassage({ citation }: { citation: Citation }) {
  return (
    <li className="mt-3 rounded-soft border-l-[3px] border-steady bg-surface-sunken px-3 py-2.5">
      <blockquote className="text-body">{citation.quote}</blockquote>
      <p className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-micro text-slate">
        <span className="text-steady">{citation.sourceType}</span>
        {citation.section !== null && <span>· {citation.section}</span>}
        <span>· {citation.chunkId}</span>
      </p>
    </li>
  );
}

function Message({ message }: { message: IntakeMessage }) {
  const fromReporter = message.role === "reporter";
  return (
    <li
      className={[
        "border-b border-rule px-5 py-4 last:border-b-0",
        // The reporter's own turns are indented and filled, so the transcript
        // reads as two voices rather than one column of alternating labels.
        fromReporter ? "bg-surface-sunken pl-16" : "",
      ].join(" ")}
    >
      <p className="font-mono text-micro uppercase tracking-label text-slate">
        {fromReporter ? "You" : "SideNote"}
      </p>
      <p className="mt-1.5 text-prose whitespace-pre-wrap">{message.text}</p>
      {message.citations.length > 0 && (
        <ul>
          {message.citations.map((citation) => (
            <CitedPassage key={citation.chunkId} citation={citation} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ChatPanel({ siteKey }: { readonly siteKey: string | null }) {
  /*
    One widget for both forms below.

    It renders inside whichever form is showing, because Turnstile injects its
    hidden input into the container and FormData only collects fields inside
    the form being submitted — outside it, the token silently never arrives.
    Every turn sends one: tokens are single use, and the widget issues a fresh
    one after each submit.
  */
  const turnstile = useTurnstile(siteKey);

  const [state, formAction, pending] = useActionState(
    sendChatMessage,
    initialChatState(),
  );
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const count = state.intake.messages.length;

  // Clear the box and scroll to the newest turn once a message has landed.
  // Keyed on message count rather than `pending` so it does not fire on a
  // rejected empty submit.
  useEffect(() => {
    formRef.current?.reset();
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);

  const outstanding = remainingSlots(state.intake.slots);
  const answeredCount = INTAKE_QUESTION_COUNT - outstanding.length;

  /*
    Everything the chat has collected, mirrored into the shared draft on every
    turn, so the switch to the form carries it. Written as an effect rather
    than inside the action because the action runs on the server and the draft
    lives in this browser.
  */
  const slots = state.intake.slots;
  const sent = state.submitted !== null;
  useEffect(() => {
    /*
      Once the report is sent the draft has done its job, and keeping it would
      make this report the next one's suggestions — the stale-draft fault, one
      lap later. The confirmation below is rendered from the action's own
      state, so clearing the store takes nothing away from the screen.
    */
    if (sent) {
      clearDraft();
      return;
    }
    const current = readDraft();
    writeDraft({
      ...current,
      draft: draftFromSlots(slots, current.draft),
    });
  }, [slots, sent]);

  const missing = missingElements(draftFromSlots(slots));

  /*
    What the form already knows, sent with the first reply so the conversation
    can start from it rather than from nothing.

    Filled AFTER mount, not during render. The server has no localStorage, so
    reading the draft while rendering would produce different HTML on the two
    sides and fail hydration. Empty on both, then populated — a hidden field
    changing after mount is invisible and costs nothing.

    The action only APPLIES it while the conversation is still at its opening,
    so a stale value cannot overwrite something the reporter has since typed.
  */
  const carried = useSyncExternalStore(
    subscribeToDraft,
    readCarriedSlots,
    // The server has no localStorage and must not guess. Empty on both sides
    // during hydration, then the real value — a hidden field changing after
    // mount is invisible and costs nothing.
    () => "",
  );

  /** Fill the reply box with a quick answer and send it. */
  function answerWith(text: string) {
    const form = formRef.current;
    if (form === null) return;
    const box = form.elements.namedItem("message");
    if (box instanceof HTMLTextAreaElement) {
      box.value = text;
      form.requestSubmit();
    }
  }

  return (
    <div>
      <ul className="overflow-hidden rounded-card border border-rule bg-surface shadow-card">
        {state.intake.messages.map((message, index) => (
          <Message key={`${index}-${message.role}`} message={message} />
        ))}
      </ul>
      {state.error !== null && (
        <p className="mt-3 rounded-card border border-rule border-l-[3px] border-l-ink bg-surface px-4 py-3 text-body">
          {state.error}
        </p>
      )}

      {state.submitted !== null ? (
        /*
          The same confirmation the form shows. One screen, so the next steps a
          reporter is offered do not depend on which intake they happened to
          choose — which was the whole complaint about this flow.
        */
        <div className="mt-4">
          <SentConfirmation
            reference={state.submitted.reference}
            caseId={state.submitted.caseId}
            medicineName={slots.drug}
            onReportAnother={() => {
              clearDraft();
              window.location.reload();
            }}
          />
        </div>
      ) : state.intake.phase === "review" ? (
        /*
          The same action, a different set of controls.

          Every button in here submits this form, so a change and a send travel
          the same path as every answer the reporter typed — one reducer, one
          copy of the conversation. A second `useActionState` for the review
          would hold its own, and the two would disagree the moment either was
          used.
        */
        <form ref={formRef} action={formAction}>
          <ReviewPanel
            slots={slots}
            review={state.review}
            pending={pending}
          />
          <TurnstileWidget
            status={turnstile.status}
            containerRef={turnstile.containerRef}
          />
        </form>
      ) : (
        <form
          ref={formRef}
          action={formAction}
          className="mt-4 rounded-card border border-rule bg-surface p-5 shadow-card"
        >
          <label htmlFor="message" className="text-body font-medium">
            Your reply
          </label>
          {/*
            The button sits beside the box, not beneath it.

            Underneath, every answer meant looking down the page for Send —
            eight times over. Next to the field it is where the eye already is
            when the typing stops. It wraps below on a narrow screen, which is
            the one case where stacking is the better arrangement.
          */}
          <div className="mt-1 flex flex-wrap items-start gap-2">
            <textarea
              id="message"
              name="message"
              rows={2}
              autoComplete="off"
              placeholder="Type here…"
              className="min-w-0 flex-1 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
            />
            <input type="hidden" name="known" value={carried} />
            <button
              type="submit"
              /*
                NOT disabled on `done`.

                When the conversation finished but the save failed, `done` was
                true and `submitted` was null — so this form rendered with the
                button permanently disabled, directly beneath a message telling
                the reporter to press send again. They could not. The one
                moment a retry is needed was the one moment the control was
                dead.
              */
              disabled={pending}
              className="min-h-11 cursor-pointer rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
          {/*
            Quick answers for the questions that are not really free text.
            They type into the box above and press the same Send.
          */}
          <QuickAnswers
            slot={state.intake.pending}
            prefill={
              state.intake.pending === null
                ? undefined
                : state.intake.prefill[state.intake.pending]
            }
            onAnswer={answerWith}
            disabled={pending}
          />

          {/*
            Progress, as a count and a ticked list.

            It used to read "Still needed: the medicine, what went wrong, their
            age, …" — a checklist rendered as a comma sentence, which only ever
            got shorter, so a reporter could not tell two-done from six-done at
            a glance.
          */}
          <div className="mt-5 border-t border-rule pt-4">
            <p className="font-mono text-micro uppercase tracking-label text-slate">
              {/*
                A correction is not question N of eight. Once the reporter has
                seen the review, the count is measuring the wrong thing: they
                are not working through a script any more, they are fixing one
                answer and going straight back.
              */}
              {state.intake.reviewed
                ? "Changing one answer"
                : `Question ${Math.min(answeredCount + 1, INTAKE_QUESTION_COUNT)} of ${INTAKE_QUESTION_COUNT}`}
            </p>
            {/*
              Eight segments, one per question, so two-done and six-done are
              distinguishable at a glance. It used to be a comma sentence that
              only ever got shorter.
            */}
            <ol className="mt-2 flex gap-1.5" aria-hidden="true">
              {Array.from({ length: INTAKE_QUESTION_COUNT }, (_, index) => (
                <li
                  key={index}
                  className={[
                    "h-1 flex-1 rounded-pill",
                    index < answeredCount ? "bg-steady" : "bg-rule",
                  ].join(" ")}
                />
              ))}
            </ol>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SLOT_ORDER.map((slot) => {
                const done = !outstanding.includes(slot);
                return (
                  <li
                    key={slot}
                    className={[
                      "flex items-center gap-1.5 rounded-pill px-3 py-1 text-meta",
                      done
                        ? "bg-steady-wash text-steady"
                        : "border border-rule text-slate",
                    ].join(" ")}
                  >
                    <span aria-hidden="true">{done ? "✓" : "○"}</span>
                    <span>{SLOT_LABELS[slot] ?? slot}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-4 border-t border-rule pt-4">
            <RequiredChecklist missing={missing} />
          </div>

          <TurnstileWidget
            status={turnstile.status}
            containerRef={turnstile.containerRef}
          />

          <p className="mt-4 text-meta text-slate">
            Prefer to see all the questions at once?{" "}
            <Link href="/report" className="text-steady hover:underline">
              Use the form
            </Link>
            . Your answers come with you.
          </p>
        </form>
      )}

      {/*
        The scroll target sits AFTER the form, not after the message list.

        It used to sit between them, so each new question scrolled the last
        message into view and left the reply box below the fold — on a phone
        the reporter had to scroll down to answer, every single turn. Scrolling
        to the end of everything puts the new question and the box to answer it
        on screen together, which is the only arrangement that lets someone
        work through eight questions without fighting the page.
      */}
      <div ref={endRef} />
    </div>
  );
}

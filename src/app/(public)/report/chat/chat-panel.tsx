"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { sendChatMessage } from "./actions";
import { initialChatState } from "./chat-state";
import {
  INTAKE_QUESTION_COUNT,
  remainingSlots,
  type IntakeMessage,
} from "@/lib/intake/conversation";
import type { Citation } from "@/lib/schemas";
import { draftFromSlots, slotsFromDraft } from "@/lib/report/draft";
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
  const draft = readDraft().draft;
  if (draft !== carriedCache.draft) {
    carriedCache = { draft, json: JSON.stringify(slotsFromDraft(draft)) };
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
    <li className="mt-2 border-l-2 border-steady pl-3">
      <blockquote className="text-prose">{citation.quote}</blockquote>
      <p className="mt-1 flex flex-wrap gap-x-3 text-micro uppercase tracking-label text-slate">
        <span className="text-steady">{citation.sourceType}</span>
        {citation.section !== null && (
          <span className="normal-case tracking-normal">{citation.section}</span>
        )}
        <span className="font-mono normal-case tracking-normal">
          {citation.chunkId}
        </span>
      </p>
    </li>
  );
}

function Message({ message }: { message: IntakeMessage }) {
  const fromReporter = message.role === "reporter";
  return (
    <li
      className={[
        "border-b border-rule py-3",
        fromReporter ? "pl-8" : "",
      ].join(" ")}
    >
      <p className="text-micro uppercase tracking-label text-slate">
        {fromReporter ? "You" : "SideNote"}
      </p>
      <p className="mt-1 text-prose whitespace-pre-wrap">{message.text}</p>
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

export function ChatPanel() {
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
  useEffect(() => {
    const current = readDraft();
    writeDraft({
      ...current,
      draft: draftFromSlots(slots, current.draft),
    });
  }, [slots]);

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
      <ul className="border-t border-rule">
        {state.intake.messages.map((message, index) => (
          <Message key={`${index}-${message.role}`} message={message} />
        ))}
      </ul>
      {state.error !== null && (
        <p className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2 text-base">
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
      ) : (
        <form ref={formRef} action={formAction} className="mt-4">
          <label htmlFor="message" className="text-base font-medium">
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
              className="min-w-0 flex-1 rounded-soft border border-rule bg-surface px-2 py-1.5 text-prose focus:outline-2 focus:outline-offset-1 focus:outline-steady"
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
              className="cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-wait disabled:opacity-60"
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
          <div className="mt-4 border-t border-rule pt-3">
            <p className="text-micro uppercase tracking-label text-slate">
              Question {Math.min(answeredCount + 1, INTAKE_QUESTION_COUNT)} of{" "}
              {INTAKE_QUESTION_COUNT}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {SLOT_ORDER.map((slot) => {
                const done = !outstanding.includes(slot);
                return (
                  <li
                    key={slot}
                    className={[
                      "flex items-baseline gap-1.5 text-meta",
                      done ? "text-steady" : "text-slate",
                    ].join(" ")}
                  >
                    <span aria-hidden="true">{done ? "✓" : "○"}</span>
                    <span>{SLOT_LABELS[slot] ?? slot}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-3 border-t border-rule pt-3">
            <RequiredChecklist missing={missing} />
          </div>

          <p className="mt-3 text-meta text-slate">
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

"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { sendChatMessage } from "./actions";
import { initialChatState } from "./chat-state";
import { remainingSlots, type IntakeMessage } from "@/lib/intake/conversation";
import type { Citation } from "@/lib/schemas";

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
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const outstanding = remainingSlots(state.intake.slots);
  const done = state.intake.phase === "complete";

  return (
    <div>
      <ul className="border-t border-rule">
        {state.intake.messages.map((message, index) => (
          <Message key={`${index}-${message.role}`} message={message} />
        ))}
      </ul>
      <div ref={endRef} />

      {state.error !== null && (
        <p className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2 text-base">
          {state.error}
        </p>
      )}

      {state.submitted !== null ? (
        <div className="mt-4 border border-rule p-3 rounded-soft">
          <p className="text-micro uppercase tracking-label text-slate">
            Your reference
          </p>
          <p className="mt-1 font-mono text-figure">
            {state.submitted.reference}
          </p>
          <p className="mt-2 text-prose">
            Keep this. A safety reviewer will read your report — quote this
            number if you contact us about it.
          </p>
          <p className="mt-3 text-meta text-slate">
            It is now in the reviewer queue.{" "}
            <Link
              href={`/case/${state.submitted.caseId}`}
              className="text-steady hover:underline"
            >
              See how a reviewer will see it
            </Link>{" "}
            — that link is here because this is a demo; a real reporter would
            not have it.
          </p>
        </div>
      ) : (
        <form ref={formRef} action={formAction} className="mt-4">
          <label htmlFor="message" className="text-base font-medium">
            Your reply
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            autoComplete="off"
            placeholder="Type here…"
            className="mt-1 w-full rounded-soft border border-rule bg-paper px-2 py-1.5 text-prose focus:outline-2 focus:outline-offset-1 focus:outline-steady"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <button
              type="submit"
              disabled={pending || done}
              className="cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send"}
            </button>
            {outstanding.length > 0 && (
              <p className="text-meta text-slate">
                Still needed: {outstanding.map((s) => SLOT_LABELS[s] ?? s).join(", ")}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

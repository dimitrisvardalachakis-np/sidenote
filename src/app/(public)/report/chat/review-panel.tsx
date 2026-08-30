"use client";

import {
  REVIEW_ORDER,
  SERIOUSNESS_PHRASES,
  type IntakeSlot,
  type IntakeSlots,
} from "@/lib/intake/conversation";
import type { ChatReview } from "@/lib/intake/review";
import { GeneratedNarrative } from "@/components/narrative";
import type { Citation } from "@/lib/schemas";

/**
 * The last screen before anything is written.
 *
 * WHY THIS EXISTS. The chat used to file the case in the same turn that
 * produced its closing message: the reporter read a verdict and their
 * reference number in one render, with the reply form already gone. Nothing
 * they had said was ever shown back to them, so a wrong medicine carried in
 * from a stale draft went into the record unseen — which is exactly what
 * happened, and is why every answer below has a control to change it.
 *
 * THE ORDER OF THIS PAGE IS A SAFETY DECISION, not a layout preference.
 * What will be filed comes first, and the send control sits directly under it,
 * ABOVE the reading of the label. NOTES.md dismissed the worry that showing
 * "this is already known" discourages reporting, on the grounds that the
 * report was already written by the time the reporter read it. That is no
 * longer true — there is now a step to drop out of — so the reading is placed
 * after the decision and closes with the same line the public search page
 * uses: finding it there does not mean it does not matter.
 */
export function ReviewPanel({
  slots,
  review,
  pending,
}: {
  slots: IntakeSlots;
  /** Null when no medicine or reaction was recorded, so nothing was searched. */
  review: ChatReview | null;
  disabled?: boolean;
  pending: boolean;
}) {
  return (
    <div className="mt-4 space-y-4">
      <section
        aria-label="What will be sent"
        className="rounded-card border border-rule bg-surface p-5 shadow-card"
      >
        <p className="font-mono text-micro uppercase tracking-label text-slate">
          What will be sent
        </p>
        <dl className="mt-3">
          {REVIEW_ORDER.map((slot) => (
            <div
              key={slot}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-3 last:border-b-0"
            >
              <dt className="w-full text-meta text-slate sm:w-[9rem]">
                {SLOT_LABELS[slot]}
              </dt>
              <dd className="min-w-0 flex-1 text-body whitespace-pre-wrap">
                {describe(slot, slots)}
              </dd>
              {/*
                A submit button, not a link. It posts the same form as every
                other turn, under `change` and carrying its slot, so the server
                re-asks the question and the conversation carries on where it
                was — one state machine, one reducer, no second path a
                correction could take. A button contributes exactly one
                name/value pair, which is why the slot IS the value and the
                field name is what marks it a change.
              */}
              <button
                type="submit"
                name="change"
                value={slot}
                disabled={pending}
                className="cursor-pointer rounded-soft border border-rule px-2.5 py-1 text-meta text-slate hover:border-ink hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                change
              </button>
            </div>
          ))}
        </dl>

        <div className="mt-5 border-t border-rule pt-4">
          <button
            type="submit"
            name="intent"
            value="submit"
            disabled={pending}
            className="min-h-11 w-full cursor-pointer rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            {pending ? "Sending…" : "Send this report"}
          </button>
          <p className="mt-2.5 text-meta text-slate">
            Nothing has been sent yet. A trained person reads every report, and
            you can change any answer above before you send it.
          </p>
        </div>
      </section>

      <LabelReading review={review} />
    </div>
  );
}

/**
 * What the published information says — and the four things that can honestly
 * be said about it, kept apart.
 *
 * This is the assertion the chat used to make from a hit count, with no model
 * having read anything. Every branch below is now either a quoted passage a
 * model identified and code verified character for character, or a plain
 * statement that no such passage was produced. None of them is a decision:
 * the reviewer still reads the case whatever this says, and the send control
 * above is offered in the same words either way.
 */
function LabelReading({ review }: { review: ChatReview | null }) {
  if (review === null) return null;
  const { outcome } = review;

  if (outcome.kind === "no_label_held") {
    return (
      <Frame title={`Published information for ${review.drug}`}>
        <p className="text-body">
          I looked for the published information for {review.drug} and could not
          find any, so there was nothing for me to check your report against.
        </p>
        <p className="mt-2 text-body text-slate">
          That is a gap in what I can see, not a finding about what happened to
          you. A safety reviewer will read this and can check sources I do not
          have.
        </p>
      </Frame>
    );
  }

  if (outcome.kind === "unreadable") {
    return (
      <Frame title={`Published information for ${review.drug}`}>
        {/* Dashed, not red. Missing information is not a warning. */}
        <div className="rounded-card border border-dashed border-rule p-4">
          <p className="text-body">
            I found passages that may be relevant but could not read them just
            now, so they are below exactly as they are written.
          </p>
          <p className="mt-2 text-meta text-slate-quiet">{outcome.reason}</p>
        </div>
        <Passages citations={review.citations} />
      </Frame>
    );
  }

  if (outcome.kind === "nothing_found") {
    return (
      <Frame title={`Published information for ${review.drug}`}>
        <p className="text-body">
          I could not find what you described in the published information for{" "}
          {review.drug}.
        </p>
        <p className="mt-2 text-body text-slate">
          That does not mean it was not caused by the medicine — it means there
          is no existing record of it, which is exactly the kind of report a
          safety reviewer needs to see.
        </p>
        <Passages citations={review.citations} />
      </Frame>
    );
  }

  return (
    <Frame title={`Published information for ${review.drug}`}>
      {/*
        The generated account, rendered by the component both public surfaces
        share. It carries non-negotiable #3 and the four signals that keep what
        a MODEL WROTE from being mistaken for what a DOCUMENT SAYS, so it is
        imported rather than approximated here.
      */}
      <GeneratedNarrative
        narrative={review.narrative}
        about={review.drug}
        footnote="The sentences above were written by a computer. The words beneath each one were copied from the published label exactly as they appear there, so you can check them. This is not medical advice and not a decision about your medicine — speak to a doctor or pharmacist."
      />

      <div className="mt-4 rounded-soft border-l-[3px] border-steady bg-surface-sunken px-4 py-3">
        <blockquote className="text-prose">{outcome.quotedSpan}</blockquote>
        {outcome.rationale !== null && (
          <p className="mt-2 text-body text-slate">{outcome.rationale}</p>
        )}
        <p className="mt-2 font-mono text-micro text-slate">
          <span className="text-steady">public</span> · {outcome.chunkId}
        </p>
        <p className="mt-2 text-meta text-slate-quiet">
          Quoted from the published label word for word.
        </p>
      </div>

      <Passages citations={review.citations} />

      <p className="mt-4 rounded-card bg-steady-wash px-4 py-3 text-body">
        Finding it here does not mean your report was unnecessary. How severe it
        was, and how often it happens, is what reviewers are watching for — so
        please still send it.
      </p>
    </Frame>
  );
}

function Frame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="What the published information says"
      className="rounded-card border border-rule bg-surface p-5 shadow-card"
    >
      <p className="font-mono text-micro uppercase tracking-label text-slate">
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Every passage that was searched, shown whatever the reading concluded.
 *
 * Shown even when nothing was found, because "these came up and none of them
 * is about it" is something a reporter can check for themselves — it may be
 * different wording for the same thing, and they are the one who knows what
 * happened.
 */
function Passages({ citations }: { citations: readonly Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className="mt-4 border-t border-rule">
      {citations.map((citation) => (
        <li key={citation.chunkId} className="border-b border-rule py-3 last:border-b-0">
          <blockquote className="border-l-2 border-rule pl-3 text-body">
            {citation.quote}
          </blockquote>
          <p className="mt-1.5 flex flex-wrap gap-x-2 pl-3 font-mono text-micro text-slate">
            <span className="text-steady">{citation.sourceType}</span>
            {citation.section !== null && <span>· {citation.section}</span>}
            <span>· {citation.chunkId}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

const SLOT_LABELS: Readonly<Record<IntakeSlot, string>> = {
  narrative: "What happened",
  drug: "Medicine",
  reaction: "What went wrong",
  age: "Age",
  sex: "Male or female",
  seriousness: "How serious",
  reporterName: "Your name",
  reporterContact: "How to reach you",
};

/**
 * One answer, in the reporter's own terms.
 *
 * `Not given` rather than an empty cell: a blank row reads as a rendering
 * fault, and this screen is asking somebody to check their own report.
 */
function describe(slot: IntakeSlot, slots: IntakeSlots): string {
  switch (slot) {
    case "age":
      return slots.age === null ? "Not given" : `${slots.age}`;
    case "sex":
      return slots.sex === null
        ? "Not given"
        : slots.sex === "unknown"
          ? "Would rather not say"
          : slots.sex;
    case "seriousness": {
      if (slots.seriousness === null) return "Not given";
      if (slots.seriousness.length === 0) return "None of those happened";
      return slots.seriousness
        .map((criterion) => SERIOUSNESS_PHRASES[criterion])
        .join(", and ");
    }
    default:
      return slots[slot] ?? "Not given";
  }
}

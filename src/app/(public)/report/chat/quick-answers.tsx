"use client";

import { useState } from "react";
import {
  NO_SERIOUSNESS,
  SERIOUSNESS_PHRASES,
  type IntakeSlot,
} from "@/lib/intake/conversation";

/**
 * Buttons for the questions that are not really free text.
 *
 * The intake asks eight turns, and most of them are structured questions
 * wearing a conversational coat: how old, male or female, how serious, your
 * name, how to reach you. The form asks the seriousness question as six plain
 * yes/no questions; the chat asked the reporter to compose a sentence about it.
 * Free text is the right instrument for the narrative and the wrong one for a
 * sex field.
 *
 * THIS DOES NOT TOUCH THE STATE MACHINE. Every control here writes text into
 * the same textarea and submits the same form, so `conversation.ts` still
 * parses free text and still has no model in it — the scripted intake is
 * unchanged, and a reporter who prefers to type still can. The buttons are a
 * faster way to say the same thing, not a second code path that could disagree
 * with the first.
 */

interface Option {
  readonly label: string;
  /** What gets typed. Must be something the slot's parser already accepts. */
  readonly text: string;
}

const SEX_OPTIONS: readonly Option[] = [
  { label: "Female", text: "female" },
  { label: "Male", text: "male" },
  { label: "I would rather not say", text: "prefer not to say" },
];

/**
 * The six criteria, in the wizard's plain wording.
 *
 * Multi-select rather than six separate turns, because the chat asks about all
 * of them in one question and splitting it would add five turns to a flow whose
 * length is already the complaint. Each phrase is one the slot's keyword parser
 * recognises, which is what keeps the buttons and the typed path in agreement.
 */
const SERIOUSNESS_OPTIONS: readonly Option[] = [
  {
    label: "They went into hospital",
    text: SERIOUSNESS_PHRASES.hospitalisation,
  },
  {
    label: "Their life was in danger",
    text: SERIOUSNESS_PHRASES.life_threatening,
  },
  {
    label: "They were left with a lasting problem",
    text: SERIOUSNESS_PHRASES.persistent_disability,
  },
  {
    label: "A baby was born with a problem",
    text: SERIOUSNESS_PHRASES.congenital_anomaly,
  },
  { label: "They died", text: SERIOUSNESS_PHRASES.death },
];

const DONT_KNOW = "I don't know";

export function QuickAnswers({
  slot,
  prefill,
  onAnswer,
  disabled,
}: {
  /** The slot the last question was about. Null once the intake is done. */
  slot: IntakeSlot | null;
  /**
   * What another page already knew about this slot, if anything.
   *
   * A SUGGESTION, and the distinction is the point: it is offered as one more
   * chip alongside the others, so accepting it types the same text into the
   * same box and runs the same parser. Nothing reaches the record without the
   * reporter pressing something.
   */
  prefill: string | undefined;
  /** Writes the text into the reply box and sends it. */
  onAnswer: (text: string) => void;
  disabled: boolean;
}) {
  const [picked, setPicked] = useState<readonly string[]>([]);

  if (slot === null) return null;

  /*
    The suggestion sits above the slot's own controls rather than inside them,
    because every slot can have one — including the four that have no quick
    answers at all. For the medicine, a name and a way to be reached, this row
    is the whole of the saved typing that crossing from the form used to give
    away for free, and it now costs one tap and gives the reporter the chance
    to say no.
  */
  const suggestion =
    prefill === undefined ? null : (
      <Row label="You told us before">
        <Chip disabled={disabled} onClick={() => onAnswer(prefill)}>
          {truncate(prefill)}
        </Chip>
      </Row>
    );

  if (slot === "sex") {
    return (
      <>
        {suggestion}
        <Row label="Or choose one">
          {SEX_OPTIONS.map((option) => (
            <Chip
              key={option.text}
              disabled={disabled}
              onClick={() => onAnswer(option.text)}
            >
              {option.label}
            </Chip>
          ))}
          <Chip disabled={disabled} onClick={() => onAnswer(DONT_KNOW)}>
            {DONT_KNOW}
          </Chip>
        </Row>
      </>
    );
  }

  if (slot === "age") {
    return (
      <>
        {suggestion}
        <Row label="Or pick an age">
          <AgeEntry disabled={disabled} onAnswer={onAnswer} />
          <Chip disabled={disabled} onClick={() => onAnswer(DONT_KNOW)}>
            {DONT_KNOW}
          </Chip>
        </Row>
      </>
    );
  }

  if (slot === "seriousness") {
    const toggle = (text: string) =>
      setPicked((current) =>
        current.includes(text)
          ? current.filter((t) => t !== text)
          : [...current, text],
      );

    return (
      <>
        {suggestion}
        <Row label="Or tick any that happened">
          {SERIOUSNESS_OPTIONS.map((option) => {
            const on = picked.includes(option.text);
            return (
              <Chip
                key={option.text}
                disabled={disabled}
                pressed={on}
                onClick={() => toggle(option.text)}
              >
                {option.label}
              </Chip>
            );
          })}
          <span className="w-full" />
          <Chip
            disabled={disabled || picked.length === 0}
            onClick={() => {
              onAnswer(picked.join(", and "));
              setPicked([]);
            }}
            primary
          >
            Send {picked.length > 0 ? `(${picked.length})` : ""}
          </Chip>
          <Chip disabled={disabled} onClick={() => onAnswer(NO_SERIOUSNESS)}>
            None of those
          </Chip>
        </Row>
      </>
    );
  }

  return suggestion;
}

/**
 * A chip is a chip, not a paragraph. A carried narrative can be hundreds of
 * words, and the whole of it inside a button would push the reply box off the
 * screen — the exact fault the scroll target below the form was moved to fix.
 */
function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= 60 ? collapsed : `${collapsed.slice(0, 57)}…`;
}

/**
 * A number field rather than a slider or a list of bands.
 *
 * "Your best guess is fine" is what the form says, and a number is the
 * shortest way to give one. It submits on Enter so the whole answer is one
 * gesture.
 */
function AgeEntry({
  disabled,
  onAnswer,
}: {
  disabled: boolean;
  onAnswer: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const send = () => {
    if (value.trim().length > 0) {
      onAnswer(value.trim());
      setValue("");
    }
  };

  return (
    <span className="flex items-center gap-1">
      <label htmlFor="quick-age" className="sr-only">
        Age in years
      </label>
      <input
        id="quick-age"
        type="number"
        inputMode="numeric"
        min={0}
        max={130}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            send();
          }
        }}
        placeholder="years"
        className="w-20 rounded-soft border border-rule bg-surface px-2 py-1 text-meta focus:outline-2 focus:outline-offset-1 focus:outline-steady"
      />
      <Chip disabled={disabled || value.trim().length === 0} onClick={send}>
        Use this
      </Chip>
    </span>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <p className="font-mono text-micro uppercase tracking-label text-slate">
        {label}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
  pressed,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  pressed?: boolean | undefined;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={[
        "cursor-pointer rounded-soft border px-2 py-1 text-meta disabled:cursor-not-allowed disabled:opacity-40",
        pressed === true
          ? "border-steady bg-steady-wash text-steady"
          : primary
            ? "border-ink bg-ink text-paper hover:border-steady hover:bg-steady"
            : "border-rule text-ink hover:border-ink hover:bg-surface-sunken",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

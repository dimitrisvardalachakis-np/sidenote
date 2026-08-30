"use client";

import { useId, useState } from "react";
import {
  NOT_KNOWN,
  UNANSWERED,
  answered,
  type Answer,
} from "@/lib/schemas/answer";
import {
  MONTH_NAMES,
  formatPartialDate,
  parsePartialDate,
  type PartialDate,
} from "@/lib/schemas/partial-date";

/**
 * Question controls.
 *
 * Two rules run through all of them.
 *
 * Every question can be left blank OR marked as not known, and those are
 * different answers. For a choice question "I don't know" is simply one more
 * radio, which is the least fiddly thing for a keyboard or a screen reader:
 * one group, one arrow-key sweep, one selection. For a typed answer it has to
 * be a separate checkbox, which then disables the box so the two cannot
 * disagree.
 *
 * Every control is associated with its label programmatically: a fieldset with
 * a legend for groups, an id and htmlFor for single inputs, and hints wired up
 * with aria-describedby rather than left as nearby text.
 */

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function ChoiceQuestion<T extends string>({
  legend,
  hint,
  choices,
  value,
  onChange,
  unknownLabel = "I don't know",
  allowUnknown = true,
}: {
  legend: string;
  hint?: string;
  choices: readonly Choice<T>[];
  value: Answer<T>;
  onChange: (next: Answer<T>) => void;
  unknownLabel?: string;
  allowUnknown?: boolean;
}) {
  const name = useId();
  const hintId = `${name}-hint`;

  return (
    <fieldset
      className="mt-6"
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className="text-body font-medium">{legend}</legend>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-[13px] leading-relaxed text-slate">
          {hint}
        </p>
      )}

      <div className="mt-2 rounded-soft border border-rule">
        {choices.map((choice) => {
          const id = `${name}-${choice.value}`;
          const selected =
            value.status === "answered" && value.value === choice.value;
          return (
            <div key={choice.value} className="border-b border-rule last:border-b-0">
              {/* The label WRAPS the input, which associates them implicitly.
                  It must not also carry htmlFor: a label that both wraps and
                  points at the same control forwards a second activation, so
                  clicking the text toggles a checkbox twice and lands back
                  where it started. */}
              <label
                className={[
                  "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5",
                  selected ? "bg-steady-wash" : "hover:bg-surface-sunken",
                ].join(" ")}
              >
                <input
                  type="radio"
                  id={id}
                  name={name}
                  checked={selected}
                  onChange={() => onChange(answered(choice.value))}
                  className="accent-steady"
                />
                <span
                  className={[
                    "text-body",
                    selected ? "font-medium text-steady" : "",
                  ].join(" ")}
                >
                  {choice.label}
                </span>
              </label>
            </div>
          );
        })}

        {allowUnknown && (
          <div className="border-t border-rule">
            <label
              className={[
                "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5",
                value.status === "unknown"
                  ? "bg-steady-wash"
                  : "hover:bg-surface-sunken",
              ].join(" ")}
            >
              <input
                type="radio"
                id={`${name}-unknown`}
                name={name}
                checked={value.status === "unknown"}
                onChange={() => onChange(NOT_KNOWN)}
                className="accent-steady"
              />
              <span
                className={[
                  "text-body",
                  value.status === "unknown" ? "text-steady" : "text-slate",
                ].join(" ")}
              >
                {unknownLabel}
              </span>
            </label>
          </div>
        )}
      </div>

      {value.status !== "unanswered" && (
        <button
          type="button"
          onClick={() => onChange(UNANSWERED)}
          className="mt-1.5 cursor-pointer text-meta text-slate underline hover:text-ink"
        >
          Clear this answer
        </button>
      )}
    </fieldset>
  );
}

export function NumberQuestion({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 130,
  unknownLabel = "I don't know",
}: {
  label: string;
  hint?: string;
  value: Answer<number>;
  onChange: (next: Answer<number>) => void;
  min?: number;
  max?: number;
  unknownLabel?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const unknown = value.status === "unknown";

  return (
    <div className="mt-6">
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-[13px] leading-relaxed text-slate">
          {hint}
        </p>
      )}

      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={unknown}
        value={value.status === "answered" ? String(value.value) : ""}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "") {
            onChange(UNANSWERED);
            return;
          }
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? answered(parsed) : UNANSWERED);
        }}
        className="mt-2 w-32 min-h-11 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:opacity-50"
      />

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          id={`${id}-unknown`}
          checked={unknown}
          onChange={(event) =>
            onChange(event.target.checked ? NOT_KNOWN : UNANSWERED)
          }
          className="accent-steady"
        />
        <span className="text-base text-slate">{unknownLabel}</span>
      </label>
    </div>
  );
}

export function TextQuestion({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  placeholder,
  unknownLabel = "I don't know",
  type = "text",
}: {
  label: string;
  hint?: string;
  value: Answer<string>;
  onChange: (next: Answer<string>) => void;
  multiline?: boolean;
  placeholder?: string;
  unknownLabel?: string;
  type?: "text" | "email" | "tel";
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const unknown = value.status === "unknown";

  /**
   * Controlled by the answer, which is safe BECAUSE the answer is no longer
   * rewritten on the way past.
   *
   * `shortText` used to be `z.string().trim()` — a zod TRANSFORM — and the
   * draft round-trips through `ReportDraft.safeParse` on every read. So a
   * trailing space was stripped the instant it was typed and the next
   * character landed against the previous word: typing "co-codamol 30 mg"
   * produced "co-codamol30mg". The value a controlled input is fed has to be
   * the value it emitted, and it was not.
   *
   * The schema validates without transforming now, so the round trip is
   * lossless and this can stay a single source of truth. Trimming happens
   * once, at submission, in `trimDraft`.
   */
  const text = value.status === "answered" ? value.value : "";

  const handle = (raw: string) => {
    // Blank means unanswered, not an empty answer. A box emptied to nothing
    // puts the question back in the "still to do" pile rather than recording
    // "". The value emitted is what was typed, spaces and all — trimming
    // happens once, at submission.
    onChange(raw.trim() === "" ? UNANSWERED : answered(raw));
  };

  const shared = {
    id,
    disabled: unknown,
    // "I don't know" empties the box rather than leaving stale text behind a
    // disabled control.
    value: unknown ? "" : text,
    placeholder,
    "aria-describedby": hint === undefined ? undefined : hintId,
    className:
      "mt-2 w-full min-h-11 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:opacity-50",
  };

  return (
    <div className="mt-6">
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-[13px] leading-relaxed text-slate">
          {hint}
        </p>
      )}

      {multiline ? (
        <textarea
          {...shared}
          rows={6}
          className={`${shared.className} text-prose`}
          onChange={(event) => handle(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          type={type}
          onChange={(event) => handle(event.target.value)}
        />
      )}

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          id={`${id}-unknown`}
          checked={unknown}
          onChange={(event) =>
            onChange(event.target.checked ? NOT_KNOWN : UNANSWERED)
          }
          className="accent-steady"
        />
        <span className="text-base text-slate">{unknownLabel}</span>
      </label>
    </div>
  );
}

/**
 * A date someone may only half remember.
 *
 * Three separate boxes rather than one text field, because "type the date as
 * YYYY-MM-DD" is a instruction that fails the people this form is for. Year on
 * its own is a complete answer. Month is optional. Day is only offered once a
 * month is chosen, since a day without a month is not a date.
 *
 * The precision follows from how much was filled in, and the sentence
 * underneath reads it straight back, so "2026" and "March 2026" are visibly
 * different answers rather than one being silently promoted to the other.
 */
export function DateQuestion({
  legend,
  hint,
  value,
  onChange,
  unknownLabel = "I don't know",
}: {
  legend: string;
  hint?: string;
  value: Answer<PartialDate>;
  onChange: (next: Answer<PartialDate>) => void;
  unknownLabel?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const unknown = value.status === "unknown";
  const current = value.status === "answered" ? value.value : null;

  /**
   * The three boxes keep their own text, rather than being derived from the
   * parsed answer.
   *
   * They have to. Deriving them means a half-typed year is not yet a valid
   * date, so the answer is "unanswered", so the box re-renders empty and eats
   * the character that was just typed. Someone typing 2026 would watch each
   * digit vanish. The parsed value is the OUTPUT of these boxes, not their
   * state, and conflating the two is what caused it.
   *
   * Seeded from the answer on first render so a restored draft shows what was
   * saved.
   */
  const seed = current === null ? [] : current.value.split("-");
  const [year, setYear] = useState(seed[0] ?? "");
  const [month, setMonth] = useState(seed[1] ?? "");
  const [day, setDay] = useState(seed[2] ?? "");

  const rebuild = (nextYear: string, nextMonth: string, nextDay: string) => {
    setYear(nextYear);
    setMonth(nextMonth);
    setDay(nextDay);

    if (nextYear.trim() === "") {
      onChange(UNANSWERED);
      return;
    }
    const pieces = [nextYear];
    if (nextMonth !== "") pieces.push(nextMonth);
    if (nextMonth !== "" && nextDay !== "") pieces.push(nextDay);
    const parsed = parsePartialDate(pieces.join("-"));
    // A year still being typed is simply not an answer yet. The boxes keep
    // the text either way.
    onChange(parsed === null ? UNANSWERED : answered(parsed));
  };

  return (
    <fieldset
      className="mt-6"
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className="text-body font-medium">{legend}</legend>
      <p id={hintId} className="mt-1 text-[13px] leading-relaxed text-slate">
        {hint ?? "If you only remember the year, just fill in the year."}
      </p>

      {/*
        Say why the boxes are locked.

        Month is dead until a year is given and Day until a month is, which is
        defensible — a day with no month is not a date — but nothing said so,
        so somebody clicking Day first got nothing at all and reported that
        they could not pick a date. The cascade is fine; the silence was not.
      */}
      {!unknown && (year === "" || month === "") && (
        <p className="mt-2 text-meta text-slate">
          {year === ""
            ? "Start with the year. Month and day open once you have."
            : "Add a month if you remember it, and the day opens after that."}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-year`} className="block text-meta text-slate">
            Year
          </label>
          <input
            id={`${id}-year`}
            type="number"
            inputMode="numeric"
            min={1900}
            max={2100}
            disabled={unknown}
            value={year}
            onChange={(event) => rebuild(event.target.value, month, day)}
            className="mt-1 w-24 min-h-11 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor={`${id}-month`} className="block text-meta text-slate">
            Month
          </label>
          <select
            id={`${id}-month`}
            disabled={unknown || year === ""}
            title={year === "" ? "Give the year first" : undefined}
            value={month}
            onChange={(event) => rebuild(year, event.target.value, day)}
            className="mt-1 min-h-11 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-slate disabled:opacity-60"
          >
            <option value="">Not sure</option>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-day`} className="block text-meta text-slate">
            Day
          </label>
          <select
            id={`${id}-day`}
            disabled={unknown || month === ""}
            title={month === "" ? "Choose a month first" : undefined}
            value={day}
            onChange={(event) => rebuild(year, month, event.target.value)}
            className="mt-1 min-h-11 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-slate disabled:opacity-60"
          >
            <option value="">Not sure</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map(
              (d) => (
                <option key={d} value={d}>
                  {Number(d)}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      {current !== null && (
        <p className="mt-2 text-meta text-slate">
          You said: <span className="text-ink">{formatPartialDate(current)}</span>
        </p>
      )}

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          id={`${id}-unknown`}
          checked={unknown}
          onChange={(event) =>
            onChange(event.target.checked ? NOT_KNOWN : UNANSWERED)
          }
          className="accent-steady"
        />
        <span className="text-base text-slate">{unknownLabel}</span>
      </label>
    </fieldset>
  );
}

/** Yes or no, with blank and "I don't know" still available. */
export function YesNoQuestion({
  legend,
  hint,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  value: Answer<"yes" | "no">;
  onChange: (next: Answer<"yes" | "no">) => void;
}) {
  return (
    <ChoiceQuestion<"yes" | "no">
      legend={legend}
      {...(hint === undefined ? {} : { hint })}
      choices={[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

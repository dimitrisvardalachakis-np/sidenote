"use client";

import { useId } from "react";
import {
  NOT_KNOWN,
  UNANSWERED,
  answered,
  type Answer,
} from "@/lib/schemas/answer";

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
      <legend className="text-base font-medium">{legend}</legend>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-meta text-slate">
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
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-row-hover"
              >
                <input
                  type="radio"
                  id={id}
                  name={name}
                  checked={selected}
                  onChange={() => onChange(answered(choice.value))}
                  className="accent-steady"
                />
                <span className="text-base">{choice.label}</span>
              </label>
            </div>
          );
        })}

        {allowUnknown && (
          <div className="border-t border-rule">
            <label
              htmlFor={`${name}-unknown`}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-row-hover"
            >
              <input
                type="radio"
                id={`${name}-unknown`}
                name={name}
                checked={value.status === "unknown"}
                onChange={() => onChange(NOT_KNOWN)}
                className="accent-steady"
              />
              <span className="text-base text-slate">{unknownLabel}</span>
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
      <label htmlFor={id} className="text-base font-medium">
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-meta text-slate">
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
        className="mt-2 w-32 rounded-soft border border-rule bg-paper px-2 py-1.5 text-base focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:opacity-50"
      />

      <label
        htmlFor={`${id}-unknown`}
        className="mt-2 flex w-fit cursor-pointer items-center gap-2"
      >
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

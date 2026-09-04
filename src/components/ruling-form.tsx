"use client";

import { useActionState, useState } from "react";
import { IdempotentForm } from "@/components/idempotent-form";
import { formatDateTime } from "@/lib/format/datetime";
import {
  EXPEDITED_WINDOW_DAYS,
  type ExpectednessDetermination,
  type ExpeditedClock,
  type IsoDate,
  type ListednessDetermination,
} from "@/lib/schemas";
import type { RulingState } from "@/app/(app)/case/[id]/ruling-state";

/**
 * The screen's primary action.
 *
 * This used to be a paragraph explaining that ruling would arrive in a later
 * cluster, on a screen whose only live control triggered a document search. A
 * triage screen has to answer "what am I supposed to do here", and this is the
 * answer.
 *
 * THE CONSEQUENCE IS SHOWN BEFORE IT IS COMMITTED. Choosing `unlisted` on a
 * serious case starts a 15-day regulatory clock; a reviewer should see the due
 * date while they are still deciding, not discover it afterwards.
 *
 * The clock is computed ON THE SERVER by the real `expeditedClock`, once,
 * under the assumption of `unlisted` — because the due date depends only on
 * Day 0 and the seriousness flags, and listedness decides only WHETHER it
 * applies. So this component chooses between two already-true statements
 * rather than recomputing a regulatory deadline in the browser, and there is
 * still exactly one implementation of the 15-day rule.
 *
 * An earlier version did call `expeditedClock` here, with an empty reactions
 * array because the reactions were not to hand — so it always returned
 * `not_applicable` and the form told a reviewer looking at a case with three
 * seriousness flags that no clock would start. Passing the computed value is
 * both simpler and the only version that can be right.
 *
 * Only a human writes a determination. `ReviewerRuling` is the one place one
 * exists, this form is the one way to write it, and it is disabled with the
 * reason stated whenever this reviewer does not hold the case.
 */
export function RulingForm({
  action,
  blockedReason,
  receivedAt,
  clockIfUnlisted,
  existing,
}: {
  action: (state: RulingState, form: FormData) => Promise<RulingState>;
  /** Null when this reviewer may write. A sentence when they may not. */
  blockedReason: string | null;
  receivedAt: IsoDate;
  /**
   * What the clock WOULD be if this case were ruled unlisted. Computed
   * server-side by the real `expeditedClock`, so it already encodes whether
   * any seriousness criterion stands — `not_applicable` means none does, and
   * a separate `reactionIsSerious` prop would be a second source of truth for
   * the same fact.
   */
  clockIfUnlisted: ExpeditedClock;
  existing: {
    readonly listedness: ListednessDetermination;
    readonly expectedness: ExpectednessDetermination;
    readonly rationale: string;
    readonly decidedBy: string;
    readonly decidedAt: string;
  } | null;
}) {
  const [state, submit, pending] = useActionState(action, {
    status: "idle",
    error: null,
  } satisfies RulingState);

  const [listedness, setListedness] = useState<ListednessDetermination>(
    existing?.listedness ?? "indeterminate",
  );
  const [expectedness, setExpectedness] = useState<ExpectednessDetermination>(
    existing?.expectedness ?? "indeterminate",
  );
  const [rationale, setRationale] = useState(existing?.rationale ?? "");

  const blocked = blockedReason !== null;
  const rationaleGiven = rationale.trim().length > 0;
  const canSubmit = !blocked && rationaleGiven && !pending;

  const unlisted = listedness === "unlisted";

  return (
    <IdempotentForm
      action={submit}
      className="rounded-card border border-rule bg-surface p-5 shadow-card"
    >
      <fieldset disabled={blocked} className="border-0 p-0">
        <div className="grid gap-5 sm:grid-cols-2">
          <Choice
            legend="Company document — listedness"
            name="listedness"
            value={listedness}
            onChange={(v) => setListedness(v as ListednessDetermination)}
            options={[
              ["listed", "Listed"],
              ["unlisted", "Unlisted"],
              ["indeterminate", "Cannot say"],
            ]}
          />
          <Choice
            legend="FDA label — expectedness"
            name="expectedness"
            value={expectedness}
            onChange={(v) => setExpectedness(v as ExpectednessDetermination)}
            options={[
              ["expected", "Expected"],
              ["unexpected", "Unexpected"],
              ["indeterminate", "Cannot say"],
            ]}
          />
        </div>

        <label
          htmlFor="rationale"
          className="mt-5 block font-mono text-micro uppercase tracking-label text-slate"
        >
          Why
        </label>
        <textarea
          id="rationale"
          name="rationale"
          rows={3}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Which passage decided it, and what the other source said."
          className="mt-1.5 w-full rounded-soft border border-rule bg-surface px-3 py-2 text-base placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:opacity-50"
        />

        {/*
          The consequence, live, beside the control rather than after it.
          --signal is correct here and only here: this IS the expedited clock.
        */}
        {/*
          The consequence, live, beside the control rather than after it.
          --signal is correct here and only here: this IS the expedited clock,
          and the wash appears only when the clock would actually start —
          `unlisted` alone does not earn it, because a case with no seriousness
          criterion standing starts no clock however it is ruled.
        */}
        <div
          className={[
            "mt-4 rounded-soft border-l-[3px] px-3 py-2.5",
            unlisted && clockIfUnlisted.state !== "not_applicable"
              ? "border-l-signal bg-signal-wash"
              : "border-l-rule bg-paper",
          ].join(" ")}
        >
          {unlisted && clockIfUnlisted.state !== "not_applicable" ? (
            <p className="text-base">
              <span className="text-signal">Unlisted and serious</span> — this
              starts the {EXPEDITED_WINDOW_DAYS}-day clock from Day 0 (
              {receivedAt}), due{" "}
              <span className="font-medium text-signal">
                {clockIfUnlisted.dueOn}
              </span>
              {clockIfUnlisted.state === "overdue" && (
                <span className="text-signal">
                  {" "}
                  · already {clockIfUnlisted.daysOverdue}d overdue
                </span>
              )}
              .
            </p>
          ) : (
            <p className="text-base text-slate">
              {!unlisted
                ? "No expedited clock starts on this ruling."
                : "Unlisted, but nothing on this case is flagged serious, so no expedited clock starts."}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-10 cursor-pointer rounded-soft bg-steady px-5 py-2 text-base font-medium text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending
              ? "Recording…"
              : existing === null
                ? "Record ruling"
                : "Update ruling"}
          </button>

          {/* Why the control is dead, next to the control. */}
          {blocked ? (
            <p className="text-meta text-slate">{blockedReason}</p>
          ) : !rationaleGiven ? (
            <p className="text-meta text-slate">
              A reason is required — an unexplained ruling is not an audit trail.
            </p>
          ) : null}
        </div>

        {/*
          THE ANNOUNCERS, ALWAYS MOUNTED AND USUALLY EMPTY.

          A live region has to exist before its content changes. The two
          paragraphs below appear at the same moment as their text, so they are
          insertions rather than updates and assistive technology routinely
          misses them — which is how recording a ruling, the most consequential
          write in the application, came to happen in silence.

          Two regions rather than one, because they are not equally urgent. A
          refused ruling should interrupt; a recorded one should wait for a
          pause. A single region cannot be both, and switching `aria-live` on an
          element is not reliably picked up.
        */}
        <p role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
          {state.error ?? ""}
        </p>
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {state.status === "recorded" ? "Ruling recorded." : ""}
        </p>

        {/* The visible half. The announcing is done above. */}
        {state.error !== null && (
          <p className="mt-2 text-meta text-ink">{state.error}</p>
        )}
        {state.status === "recorded" && (
          <p className="mt-2 text-meta text-steady">Ruling recorded.</p>
        )}
      </fieldset>

      {existing !== null && (
        <p className="mt-4 border-t border-rule pt-3 font-mono text-micro uppercase tracking-label text-slate">
          Ruled by <span className="text-ink">{existing.decidedBy}</span> ·{" "}
          <span className="normal-case tracking-normal">
            {formatDateTime(existing.decidedAt)}
          </span>
        </p>
      )}
    </IdempotentForm>
  );
}

function Choice({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="font-mono text-micro uppercase tracking-label text-slate">
        {legend}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([option, label]) => {
          const current = value === option;
          return (
            /*
              A pill with a real radio inside it, kept `sr-only` rather than
              replaced. The keyboard, the form payload and the screen reader
              all still see a radio group; only the paint is ours.
            */
            <label
              key={option}
              className={[
                "flex min-h-9 cursor-pointer items-center rounded-pill border px-3.5 py-1.5 text-base",
                current
                  ? "border-steady bg-steady text-surface"
                  : "border-rule text-slate hover:border-steady-line hover:text-ink",
              ].join(" ")}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={current}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

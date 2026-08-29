"use client";

import { useActionState, useState } from "react";
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
    <form action={submit}>
      <fieldset disabled={blocked} className="border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
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
          className="mt-4 block text-micro uppercase tracking-label text-slate"
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
          className="mt-1 w-full rounded-soft border border-rule bg-paper px-2 py-1.5 text-base focus:outline-2 focus:outline-offset-1 focus:outline-steady disabled:opacity-50"
        />

        {/*
          The consequence, live, beside the control rather than after it.
          --signal is correct here and only here: this IS the expedited clock.
        */}
        <div className="mt-3 border-l-2 border-rule pl-3">
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

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="cursor-pointer rounded-soft border border-ink bg-ink px-4 py-1.5 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-not-allowed disabled:opacity-40"
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

        {state.error !== null && (
          <p role="alert" className="mt-2 text-meta text-ink">
            {state.error}
          </p>
        )}
        {state.status === "recorded" && (
          <p role="status" className="mt-2 text-meta text-steady">
            Ruling recorded.
          </p>
        )}
      </fieldset>

      {existing !== null && (
        <p className="mt-3 border-t border-rule pt-2 text-micro uppercase tracking-label text-slate">
          Ruled by <span className="text-ink">{existing.decidedBy}</span> ·{" "}
          <span className="normal-case tracking-normal">
            {existing.decidedAt.slice(0, 16).replace("T", " ")}
          </span>
        </p>
      )}
    </form>
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
      <legend className="text-micro uppercase tracking-label text-slate">
        {legend}
      </legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map(([option, label]) => {
          const current = value === option;
          return (
            <label
              key={option}
              className={[
                "cursor-pointer rounded-soft border px-2 py-1 text-meta",
                current
                  ? "border-steady bg-steady-wash text-steady"
                  : "border-rule text-slate hover:border-ink hover:text-ink",
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

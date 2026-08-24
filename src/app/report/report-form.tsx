"use client";

import { useActionState, useState, type ReactNode } from "react";
import { submitReport } from "./actions";
import { INITIAL_REPORT_STATE } from "./form-state";
import { SERIOUSNESS_CRITERIA } from "@/lib/schemas";
import {
  OUTCOME_LABELS,
  PublicReport,
  RELATIONSHIP_LABELS,
  ReportedOutcome,
  ReporterRelationship,
  SERIOUS_OUTCOME_LABELS,
  readReportFormValues,
  toFieldErrors,
  type PublicReportFieldErrors,
} from "@/lib/schemas/public-report";

type FieldName = keyof PublicReport;

/**
 * Errors are NOT rendered in --signal.
 *
 * CLAUDE.md reserves that red for expedited and overdue, "nothing else,
 * ever". A reviewer who has learned that red can also mean "you mistyped an
 * email" is a reviewer who will hesitate the day it means a report is late.
 * So an invalid field is marked by a darker border and a message in --ink at
 * full weight, which is plenty loud on a page that is otherwise all hairlines
 * and grey — and it costs nothing, because the message itself says what to do.
 */
function fieldClass(invalid: boolean): string {
  return [
    "mt-1 w-full rounded-soft border bg-paper px-2 py-1.5 text-base",
    "focus:outline-2 focus:outline-offset-1 focus:outline-steady",
    invalid ? "border-ink" : "border-rule",
  ].join(" ");
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: FieldName;
  label: string;
  hint?: string;
  error: string | undefined;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = `f-${name}`;
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mt-4">
      <label htmlFor={id} className="text-base font-medium">
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="mt-0.5 text-meta text-slate">
          {hint}
        </p>
      )}
      {children({ id, describedBy })}
      {error !== undefined && (
        <p id={errorId} className="mt-1 text-meta font-medium text-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReportForm() {
  const [state, formAction, pending] = useActionState(
    submitReport,
    INITIAL_REPORT_STATE,
  );
  const [clientErrors, setClientErrors] = useState<PublicReportFieldErrors>({});

  // Client errors win while they exist: they are the more recent judgement.
  // Once the client is satisfied and the server still objects, the server's
  // message is what the reporter needs to see.
  const errors: PublicReportFieldErrors =
    Object.keys(clientErrors).length > 0 ? clientErrors : state.errors;

  const v = state.values;

  /**
   * The client half of the validation.
   *
   * Same schema, same reader as the Server Action — the point is that this is
   * a courtesy that saves a round trip, not a security boundary. If it is
   * bypassed, nothing bad happens, because the action validates again and
   * that is the check that counts.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const parsed = PublicReport.safeParse(
      readReportFormValues(new FormData(form)),
    );
    if (parsed.success) {
      setClientErrors({});
      return; // let the action run
    }
    event.preventDefault();
    const fieldErrors = toFieldErrors(parsed.error);
    setClientErrors(fieldErrors);
    const first = Object.keys(fieldErrors)[0];
    if (first !== undefined) {
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate>
      {errorCount > 0 && (
        <div
          role="alert"
          className="mb-6 border-l-2 border-ink bg-row-hover px-3 py-2"
        >
          <p className="text-base font-medium">
            {errorCount === 1
              ? "One thing needs your attention before we can take this."
              : `${errorCount} things need your attention before we can take this.`}
          </p>
          {errors.form !== undefined && (
            <p className="mt-1 text-base">{errors.form}</p>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <h2 className="text-title font-medium">What happened</h2>

      <Field
        name="reactionTerm"
        label="What went wrong?"
        hint="A few words is fine — for example, “a rash on both arms”."
        error={errors.reactionTerm}
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            name="reactionTerm"
            type="text"
            defaultValue={v.reactionTerm}
            aria-invalid={errors.reactionTerm !== undefined}
            aria-describedby={describedBy}
            className={fieldClass(errors.reactionTerm !== undefined)}
          />
        )}
      </Field>

      <Field
        name="narrative"
        label="Tell us what happened, in your own words"
        hint="What you noticed, when it started, and anything you think matters. There is no wrong way to write this."
        error={errors.narrative}
      >
        {({ id, describedBy }) => (
          <textarea
            id={id}
            name="narrative"
            rows={6}
            defaultValue={v.narrative}
            aria-invalid={errors.narrative !== undefined}
            aria-describedby={describedBy}
            className={`${fieldClass(errors.narrative !== undefined)} text-prose`}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="onset"
          label="When did it start?"
          hint="Leave blank if you are not sure."
          error={errors.onset}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="onset"
              type="date"
              defaultValue={v.onset}
              aria-invalid={errors.onset !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.onset !== undefined)}
            />
          )}
        </Field>

        <Field name="outcome" label="How are they now?" error={errors.outcome}>
          {({ id, describedBy }) => (
            <select
              id={id}
              name="outcome"
              defaultValue={v.outcome}
              aria-invalid={errors.outcome !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.outcome !== undefined)}
            >
              {ReportedOutcome.options.map((option) => (
                <option key={option} value={option}>
                  {OUTCOME_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <fieldset className="mt-4">
        <legend className="text-base font-medium">
          Did any of these happen?
        </legend>
        <p className="mt-0.5 text-meta text-slate">
          Tick everything that applies. Leave them all unticked if none did.
        </p>
        <div className="mt-2 border border-rule rounded-soft">
          {SERIOUSNESS_CRITERIA.map((criterion) => (
            <label
              key={criterion}
              className="flex items-start gap-2 border-b border-rule px-3 py-2 last:border-b-0 hover:bg-row-hover"
            >
              <input
                type="checkbox"
                name="seriousOutcomes"
                value={criterion}
                defaultChecked={v.seriousOutcomes.includes(criterion)}
                className="mt-0.5 accent-steady"
              />
              <span className="text-base">
                {SERIOUS_OUTCOME_LABELS[criterion]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <hr className="my-8" />

      {/* ---------------------------------------------------------------- */}
      <h2 className="text-title font-medium">The medicine</h2>

      <Field
        name="medicineName"
        label="What is it called?"
        hint="The name on the box or the label."
        error={errors.medicineName}
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            name="medicineName"
            type="text"
            defaultValue={v.medicineName}
            aria-invalid={errors.medicineName !== undefined}
            aria-describedby={describedBy}
            className={fieldClass(errors.medicineName !== undefined)}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="medicineDose"
          label="How much, and how often?"
          hint="Optional."
          error={errors.medicineDose}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="medicineDose"
              type="text"
              defaultValue={v.medicineDose}
              aria-describedby={describedBy}
              className={fieldClass(errors.medicineDose !== undefined)}
            />
          )}
        </Field>

        <Field
          name="medicineReason"
          label="What was it for?"
          hint="Optional."
          error={errors.medicineReason}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="medicineReason"
              type="text"
              defaultValue={v.medicineReason}
              aria-describedby={describedBy}
              className={fieldClass(errors.medicineReason !== undefined)}
            />
          )}
        </Field>

        <Field
          name="startedOn"
          label="When did they start taking it?"
          error={errors.startedOn}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="startedOn"
              type="date"
              defaultValue={v.startedOn}
              aria-describedby={describedBy}
              className={fieldClass(errors.startedOn !== undefined)}
            />
          )}
        </Field>

        <Field
          name="stoppedOn"
          label="When did they stop?"
          hint="Leave blank if they are still taking it."
          error={errors.stoppedOn}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="stoppedOn"
              type="date"
              defaultValue={v.stoppedOn}
              aria-invalid={errors.stoppedOn !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.stoppedOn !== undefined)}
            />
          )}
        </Field>

        <Field
          name="stoppedTaking"
          label="Did they stop taking it because of this?"
          error={errors.stoppedTaking}
        >
          {({ id, describedBy }) => (
            <select
              id={id}
              name="stoppedTaking"
              defaultValue={v.stoppedTaking}
              aria-describedby={describedBy}
              className={fieldClass(false)}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">I do not know</option>
            </select>
          )}
        </Field>

        <Field
          name="improvedAfterStopping"
          label="Did it get better after stopping?"
          error={errors.improvedAfterStopping}
        >
          {({ id, describedBy }) => (
            <select
              id={id}
              name="improvedAfterStopping"
              defaultValue={v.improvedAfterStopping}
              aria-describedby={describedBy}
              className={fieldClass(false)}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">I do not know</option>
            </select>
          )}
        </Field>
      </div>

      <hr className="my-8" />

      {/* ---------------------------------------------------------------- */}
      <h2 className="text-title font-medium">The person affected</h2>
      <p className="mt-1 text-meta text-slate">
        We do not want their full name. One of these three is enough.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          name="patientInitials"
          label="Initials"
          hint="For example, J.M."
          error={errors.patientInitials}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="patientInitials"
              type="text"
              defaultValue={v.patientInitials}
              aria-invalid={errors.patientInitials !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.patientInitials !== undefined)}
            />
          )}
        </Field>

        <Field
          name="patientAgeYears"
          label="Age in years"
          error={errors.patientAgeYears}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="patientAgeYears"
              type="text"
              inputMode="numeric"
              defaultValue={v.patientAgeYears}
              aria-invalid={errors.patientAgeYears !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.patientAgeYears !== undefined)}
            />
          )}
        </Field>

        <Field name="patientSex" label="Male or female?" error={errors.patientSex}>
          {({ id, describedBy }) => (
            <select
              id={id}
              name="patientSex"
              defaultValue={v.patientSex}
              aria-describedby={describedBy}
              className={fieldClass(false)}
            >
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="unknown">I do not know</option>
            </select>
          )}
        </Field>
      </div>

      <hr className="my-8" />

      {/* ---------------------------------------------------------------- */}
      <h2 className="text-title font-medium">About you</h2>
      <p className="mt-1 text-meta text-slate">
        So we can come back to you if something is unclear.
      </p>

      <Field name="relationship" label="How are you involved?" error={errors.relationship}>
        {({ id, describedBy }) => (
          <select
            id={id}
            name="relationship"
            defaultValue={v.relationship}
            aria-describedby={describedBy}
            className={fieldClass(false)}
          >
            {ReporterRelationship.options.map((option) => (
              <option key={option} value={option}>
                {RELATIONSHIP_LABELS[option]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="reporterName" label="Your name" error={errors.reporterName}>
          {({ id, describedBy }) => (
            <input
              id={id}
              name="reporterName"
              type="text"
              defaultValue={v.reporterName}
              aria-describedby={describedBy}
              className={fieldClass(errors.reporterName !== undefined)}
            />
          )}
        </Field>

        <Field
          name="reporterEmail"
          label="Email address"
          error={errors.reporterEmail}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="reporterEmail"
              type="email"
              defaultValue={v.reporterEmail}
              aria-invalid={errors.reporterEmail !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.reporterEmail !== undefined)}
            />
          )}
        </Field>

        <Field name="reporterPhone" label="Phone number" error={errors.reporterPhone}>
          {({ id, describedBy }) => (
            <input
              id={id}
              name="reporterPhone"
              type="tel"
              defaultValue={v.reporterPhone}
              aria-describedby={describedBy}
              className={fieldClass(errors.reporterPhone !== undefined)}
            />
          )}
        </Field>

        <Field
          name="reporterCountry"
          label="Country"
          hint="Two letters, for example GB or DE."
          error={errors.reporterCountry}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              name="reporterCountry"
              type="text"
              maxLength={2}
              defaultValue={v.reporterCountry}
              aria-invalid={errors.reporterCountry !== undefined}
              aria-describedby={describedBy}
              className={fieldClass(errors.reporterCountry !== undefined)}
            />
          )}
        </Field>
      </div>

      <label className="mt-4 flex items-start gap-2">
        <input
          type="checkbox"
          name="contactPermitted"
          defaultChecked={v.contactPermitted}
          className="mt-0.5 accent-steady"
        />
        <span className="text-base">
          You may contact me about this report.
          <span className="mt-0.5 block text-meta text-slate">
            Untick if you would rather we did not. We will still use the report.
          </span>
        </span>
      </label>

      <hr className="my-8" />

      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:bg-steady hover:border-steady disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send report"}
      </button>
      <p className="mt-2 text-meta text-slate">
        Nothing is sent until you press this.
      </p>
    </form>
  );
}

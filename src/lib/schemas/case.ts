/**
 * Case — the thing a reviewer opens, and the four criteria that decide whether
 * it is a valid report at all.
 *
 * The single most important design decision in this file: the four minimum
 * criteria are NOT required by the schema. An incomplete case is a real,
 * storable, displayable state — a public reporter submits a form with half the
 * fields blank and that report still exists and still needs triaging. If zod
 * demanded a patient and a reporter and a drug and an event, an incomplete
 * case could not be represented, and CLAUDE.md's requirement that "the UI must
 * say *which* is missing" would be unimplementable.
 *
 * So the schema stores what arrived, and `caseValidity` reports on it.
 * Validity is a question you ask about a case, not a precondition for having
 * one.
 */
import { z } from "zod";
import {
  CaseId,
  CaseReference,
  IsoDate,
  IsoDateTime,
  ReviewerId,
} from "./primitives";
import { Patient, isIdentifiablePatient } from "./patient";
import { ReporterInfo, isIdentifiableReporter } from "./reporter";
import { SuspectDrug, suspectDrugsOf } from "./drug";
import { Reaction, anyReactionSerious } from "./reaction";

/** How the report reached us. Drives nothing yet; reported to the regulator. */
export const CaseOrigin = z.enum([
  "public_form",
  "email",
  "literature",
  "clinical_trial",
  "health_authority",
]);
export type CaseOrigin = z.output<typeof CaseOrigin>;

export const CaseStatus = z.enum([
  "received", // in the queue, nobody has opened it
  "in_review", // claimed by a reviewer
  "assessed", // a ruling exists
  "reported", // sent to the regulator
  "closed",
]);
export type CaseStatus = z.output<typeof CaseStatus>;

export const Case = z.object({
  id: CaseId,
  /** What the public reporter was shown. Human-quotable over the phone. */
  reference: CaseReference,
  origin: CaseOrigin,
  /**
   * Day 0. The day the company first became aware of the report — not the day
   * the record was created, which can be later. Every expedited deadline in
   * the system counts from this field, so it is a calendar date rather than an
   * instant: the regulation counts days, not hours.
   */
  receivedAt: IsoDate,

  // The four minimum criteria. Nullable and possibly-empty by design.
  patient: Patient.nullable(),
  reporter: ReporterInfo.nullable(),
  drugs: z.array(SuspectDrug),
  reactions: z.array(Reaction),

  /**
   * The reporter's account in their own words. Seriousness triggers index into
   * this string, so it must be stored exactly as submitted — re-wrapping or
   * trimming it later would silently move every highlight.
   */
  narrative: z.string(),

  status: CaseStatus,
  /**
   * One case, one reviewer. A MIRROR, not the source of truth: the claim is
   * arbitrated by the CaseCoordinator Durable Object, keyed
   * `idFromName(caseId)`. Ask the coordinator before writing to a case; this
   * field is for display and for queries that do not need to be exact.
   */
  assignedTo: ReviewerId.nullable(),

  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Case = z.output<typeof Case>;

// ---------------------------------------------------------------------------
// Validity — the four minimum criteria
// ---------------------------------------------------------------------------

export const VALIDITY_CRITERIA = [
  "patient",
  "reporter",
  "suspect_drug",
  "event",
] as const;

export const ValidityCriterion = z.enum(VALIDITY_CRITERIA);
export type ValidityCriterion = z.output<typeof ValidityCriterion>;

/** Exact wording for the UI. CLAUDE.md requires it say *which* is missing. */
export const VALIDITY_LABELS: Readonly<Record<ValidityCriterion, string>> = {
  patient: "An identifiable patient",
  reporter: "An identifiable reporter",
  suspect_drug: "A suspect drug",
  event: "An event",
};

/**
 * The four fields validity is computed from — and nothing else.
 *
 * Deliberately structural rather than `Case`. The public report form in step 5
 * needs to tell a reporter what is still missing *before* a Case exists, and a
 * draft is not a Case: it has no id, no reference, no receivedAt. A `Case`
 * satisfies this interface automatically, so `caseValidity(someCase)` works
 * exactly as the brief asks while the same function also serves the form.
 */
export interface ValidityInput {
  readonly patient: Patient | null;
  readonly reporter: ReporterInfo | null;
  readonly drugs: readonly SuspectDrug[];
  readonly reactions: readonly Reaction[];
}

export interface CaseValidity {
  readonly isValid: boolean;
  /** In canonical order, so the UI lists them the same way every time. */
  readonly missing: readonly ValidityCriterion[];
  readonly present: readonly ValidityCriterion[];
}

/**
 * Which of the four minimum criteria this case fails.
 *
 * Pure: no clock, no I/O, no `new Date()`. The same case always returns the
 * same answer, which is what lets it run identically in a Server Component, a
 * Server Action, and a unit test.
 *
 * Note it asks whether the patient and reporter are *identifiable*, not
 * whether the objects exist. A Patient with every field null is a form that
 * was submitted empty, and counting it as present would be the difference
 * between a report the regulator accepts and one they reject.
 */
export function caseValidity(input: ValidityInput): CaseValidity {
  const missing: ValidityCriterion[] = [];

  if (!isIdentifiablePatient(input.patient)) missing.push("patient");
  if (!isIdentifiableReporter(input.reporter)) missing.push("reporter");
  if (suspectDrugsOf(input.drugs).length === 0) missing.push("suspect_drug");
  if (input.reactions.length === 0) missing.push("event");

  return {
    isValid: missing.length === 0,
    missing,
    present: VALIDITY_CRITERIA.filter((c) => !missing.includes(c)),
  };
}

// ---------------------------------------------------------------------------
// The expedited clock
// ---------------------------------------------------------------------------

/**
 * Serious and unlisted must reach the regulator within 15 days of Day 0.
 * Named rather than inlined so there is exactly one place to change it if a
 * region's rule differs.
 */
export const EXPEDITED_WINDOW_DAYS = 15;

const MS_PER_DAY = 86_400_000;

/**
 * ISO calendar dates are parsed at UTC midnight throughout. Doing this in
 * local time would make a case near midnight appear to gain or lose a day
 * depending on where the reviewer is sitting, and the reviewers are not all in
 * one timezone.
 */
function atUtcMidnight(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Day 0 plus fifteen days. */
export function expeditedDeadline(receivedAt: IsoDate): IsoDate {
  const due = new Date(atUtcMidnight(receivedAt) + EXPEDITED_WINDOW_DAYS * MS_PER_DAY);
  return due.toISOString().slice(0, 10);
}

/**
 * The state of a case's regulatory clock.
 *
 * `not_applicable` is a distinct variant rather than a null deadline, because
 * a case that never had a clock and a case whose clock has not been worked out
 * yet must not render identically. Only `overdue` and a `running` clock are
 * allowed to use `--signal`; CLAUDE.md is emphatic that the red is for nothing
 * else, ever.
 */
export type ExpeditedClock =
  | { readonly state: "not_applicable" }
  | {
      readonly state: "running";
      readonly dueOn: IsoDate;
      readonly daysRemaining: number;
    }
  | {
      readonly state: "overdue";
      readonly dueOn: IsoDate;
      readonly daysOverdue: number;
    };

/**
 * Compute the clock for a case.
 *
 * `today` is a parameter, not `new Date()`. This function has to give the same
 * answer in a Server Component render, in the nightly cron sweep, and in a
 * test that pins the date — and a function that reads the wall clock cannot do
 * that. It also means the queue can be rendered "as of" any date, which is how
 * the seeded fixtures in step 8 produce a believable spread of clock states.
 *
 * `isUnlisted` comes from the assessment, which is a separate record; passing
 * it in keeps this file free of any dependency on assessment.ts.
 */
export function expeditedClock(
  input: { readonly receivedAt: IsoDate; readonly reactions: readonly Reaction[] },
  isUnlisted: boolean,
  today: IsoDate,
): ExpeditedClock {
  if (!isUnlisted || !anyReactionSerious(input.reactions)) {
    return { state: "not_applicable" };
  }

  const dueOn = expeditedDeadline(input.receivedAt);
  const days = Math.round((atUtcMidnight(dueOn) - atUtcMidnight(today)) / MS_PER_DAY);

  return days < 0
    ? { state: "overdue", dueOn, daysOverdue: -days }
    : { state: "running", dueOn, daysRemaining: days };
}

/**
 * The public report. One schema, imported by the client form and by the
 * server, and genuinely run on both.
 *
 * CLAUDE.md non-negotiable #2. The four validity criteria, the seriousness
 * criteria and the dechallenge/rechallenge definitions it sets out are
 * authoritative; this file encodes them without restating them.
 *
 * Two things shape everything below.
 *
 * First, every field is an Answer, not a value. Blank and "I don't know" are
 * different facts and both are recorded. See answer.ts.
 *
 * Second, none of the wording here is regulatory. The questions in step 3 map
 * onto the seriousness criteria one for one, but a frightened person filling
 * this in at midnight should never meet the word "hospitalisation" or be asked
 * to classify anything. The mapping is our job, not theirs.
 */
import { z } from "zod";
import { answer, isAnswered, type Answer } from "./answer";
import { PartialDate } from "./partial-date";
import { ReportAbout } from "./pronouns";

export { ReportAbout };

/** Yes, no, or (via the Answer wrapper) blank and "I don't know". */
export const YesNo = z.enum(["yes", "no"]);
export type YesNo = z.output<typeof YesNo>;

export const Sex = z.enum(["female", "male", "other"]);
export type Sex = z.output<typeof Sex>;

/** How the person is now, in words a reporter would use. */
export const CurrentState = z.enum([
  "better_now",
  "getting_better",
  "no_change",
  "worse",
  "died",
]);
export type CurrentState = z.output<typeof CurrentState>;

export const CURRENT_STATE_LABELS: Readonly<Record<CurrentState, string>> = {
  better_now: "All better now",
  getting_better: "Getting better",
  no_change: "About the same",
  worse: "Worse",
  died: "They died",
};

/** How the person filling this in is connected to what happened. */
export const ReporterRole = z.enum([
  "self",
  "family_or_friend",
  "carer",
  "health_worker",
  "other",
]);
export type ReporterRole = z.output<typeof ReporterRole>;

export const REPORTER_ROLE_LABELS: Readonly<Record<ReporterRole, string>> = {
  self: "It happened to me",
  family_or_friend: "I am family or a friend",
  carer: "I look after them",
  health_worker: "I work in health care",
  other: "Something else",
};

const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(5000);

// ---------------------------------------------------------------------------
// The five steps
// ---------------------------------------------------------------------------

/**
 * Step 3 asks about hospital and emergencies in plain words.
 *
 * Each field is one of the criteria CLAUDE.md lists, but the reporter is never
 * shown that list and is never asked to judge which applies. They answer what
 * happened; the mapping happens on our side.
 */
export const ReportDraft = z.object({
  // 1 — Who this is about
  about: answer(ReportAbout),
  age: answer(z.number().int().nonnegative().max(130)),
  sex: answer(Sex),

  // 2 — What happened
  whatHappened: answer(longText),
  startedOn: answer(PartialDate),
  currentState: answer(CurrentState),

  // 3 — Hospital and emergencies, in plain language
  wentToHospital: answer(YesNo),
  stayedLongerInHospital: answer(YesNo),
  lifeInDanger: answer(YesNo),
  lastingProblem: answer(YesNo),
  babyHarmed: answer(YesNo),
  died: answer(YesNo),

  // 4 — The medicine
  medicineName: answer(shortText),
  batchNumber: answer(shortText),
  dose: answer(shortText),
  takenFor: answer(shortText),
  startedMedicineOn: answer(PartialDate),
  stoppedMedicine: answer(YesNo),
  stoppedMedicineOn: answer(PartialDate),
  betterAfterStopping: answer(YesNo),
  startedAgain: answer(YesNo),
  cameBackAfterStartingAgain: answer(YesNo),

  // 5 — About you
  yourRole: answer(ReporterRole),
  yourName: answer(shortText),
  yourEmail: answer(z.email()),
  yourPhone: answer(z.string().trim().min(3).max(40)),
  country: answer(z.string().trim().regex(/^[A-Za-z]{2}$/)),
  mayContactYou: answer(YesNo),
});
export type ReportDraft = z.output<typeof ReportDraft>;

/** A blank form. Every field asked, nothing answered. */
export const EMPTY_DRAFT: ReportDraft = Object.freeze(
  Object.fromEntries(
    Object.keys(ReportDraft.shape).map((key) => [key, { status: "unanswered" }]),
  ) as unknown as ReportDraft,
);

// ---------------------------------------------------------------------------
// The four things a report needs
// ---------------------------------------------------------------------------

export const MissingElement = z.enum([
  "who_it_happened_to",
  "who_you_are",
  "the_medicine",
  "what_happened",
]);
export type MissingElement = z.output<typeof MissingElement>;

/**
 * What to say when one is missing.
 *
 * Plain, second person, and it always says what to do next rather than what
 * went wrong. "Invalid case" tells a frightened person nothing they can act
 * on.
 */
export const MISSING_MESSAGES: Readonly<Record<MissingElement, string>> = {
  who_it_happened_to:
    "We do not know who this happened to. Tell us how old they are, or whether they are female or male.",
  who_you_are:
    "We do not know who you are. Give us your name, or an email address, or a phone number.",
  the_medicine:
    "We do not know which medicine to look at. Tell us the name on the box.",
  what_happened:
    "We do not know what went wrong. Tell us in a few words what you noticed.",
};

/**
 * Whether we know who this happened to.
 *
 * A self-report inherits it from step 5: if we can identify you, we can
 * identify the person, because they are the same person. For anyone else we
 * need at least one detail about them.
 */
function knowsWhoItHappenedTo(draft: ReportDraft): boolean {
  const about = isAnswered(draft.about) ? draft.about.value : null;
  if (about === "self") return knowsWhoYouAre(draft);
  return isAnswered(draft.age) || isAnswered(draft.sex);
}

function knowsWhoYouAre(draft: ReportDraft): boolean {
  return (
    isAnswered(draft.yourName) ||
    isAnswered(draft.yourEmail) ||
    isAnswered(draft.yourPhone)
  );
}

/** Which of the four are still missing, in a fixed order. */
export function missingElements(draft: ReportDraft): readonly MissingElement[] {
  const missing: MissingElement[] = [];
  if (!knowsWhoItHappenedTo(draft)) missing.push("who_it_happened_to");
  if (!knowsWhoYouAre(draft)) missing.push("who_you_are");
  if (!isAnswered(draft.medicineName)) missing.push("the_medicine");
  if (!isAnswered(draft.whatHappened)) missing.push("what_happened");
  return missing;
}

/**
 * The submission gate: a draft plus the rule that all four must be present.
 *
 * Kept separate from ReportDraft so a half-finished form is still a valid
 * object to hold, save and restore. A partly-filled report is a real thing;
 * only sending it needs all four.
 */
export const Report = ReportDraft.superRefine((draft, ctx) => {
  for (const element of missingElements(draft)) {
    ctx.addIssue({
      code: "custom",
      path: [element],
      message: MISSING_MESSAGES[element],
    });
  }
});
export type Report = z.output<typeof Report>;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const STEP_IDS = [
  "about",
  "what_happened",
  "hospital",
  "medicine",
  "you",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_TITLES: Readonly<Record<StepId, string>> = {
  about: "Who this is about",
  what_happened: "What happened",
  hospital: "Hospital and emergencies",
  medicine: "The medicine",
  you: "About you",
};

/** Which fields belong to which step. Used for per-step checks and progress. */
export const STEP_FIELDS: Readonly<
  Record<StepId, readonly (keyof ReportDraft)[]>
> = {
  about: ["about", "age", "sex"],
  what_happened: ["whatHappened", "startedOn", "currentState"],
  hospital: [
    "wentToHospital",
    "stayedLongerInHospital",
    "lifeInDanger",
    "lastingProblem",
    "babyHarmed",
    "died",
  ],
  medicine: [
    "medicineName",
    "batchNumber",
    "dose",
    "takenFor",
    "startedMedicineOn",
    "stoppedMedicine",
    "stoppedMedicineOn",
    "betterAfterStopping",
    "startedAgain",
    "cameBackAfterStartingAgain",
  ],
  you: ["yourRole", "yourName", "yourEmail", "yourPhone", "country", "mayContactYou"],
};

/** How many questions on this step have been dealt with, either way. */
export function stepProgress(
  draft: ReportDraft,
  step: StepId,
): { readonly resolved: number; readonly total: number } {
  const fields = STEP_FIELDS[step];
  const resolved = fields.filter(
    (field) => (draft[field] as Answer<unknown>).status !== "unanswered",
  ).length;
  return { resolved, total: fields.length };
}

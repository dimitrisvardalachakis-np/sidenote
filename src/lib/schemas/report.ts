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

/**
 * Text a reporter typed, held exactly as they typed it.
 *
 * NOT `.trim()`, and the difference is a bug somebody hit. `.trim()` is a zod
 * TRANSFORM, and the draft round-trips through `ReportDraft.safeParse` on
 * every read — so a trailing space was stripped the instant it was typed,
 * before the next character arrived. Typing "Amoxil 500" produced
 * "Amoxil500": every space eaten, every word run together.
 *
 * So the shape here VALIDATES without rewriting. Whitespace-only is still
 * refused — it is not an answer — but a space in the middle of typing is left
 * alone, because the person is still typing. Normalisation happens once, at
 * the submission boundary, in `trimDraft`.
 */
const notBlank = (value: string) => value.trim().length > 0;
const BLANK_MESSAGE = "This needs some text, not just spaces";

const shortText = z
  .string()
  .max(200)
  .refine(notBlank, { message: BLANK_MESSAGE });
const longText = z
  .string()
  .max(5000)
  .refine(notBlank, { message: BLANK_MESSAGE });

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
  yourPhone: answer(
    z
      .string()
      .max(40)
      .refine((value) => value.trim().length >= 3, {
        message: "A phone number needs at least three characters",
      }),
  ),
  // A country NAME, not a two-letter code. Asking someone who is frightened
  // to know that GB means the United Kingdom is exactly the kind of small
  // cruelty this surface is supposed to avoid. A reviewer maps it later.
  country: answer(shortText),
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
 * Trim every answered string, once, on the way out.
 *
 * The one place normalisation belongs: the reporter has finished typing, so
 * "Amoxil 500 " and "Amoxil 500" should become the same stored value. Doing it
 * per keystroke is what ate their spaces.
 *
 * Applied before the submission gate rather than inside it, so `Report` stays
 * a validator rather than a rewriter — and so what a reviewer eventually reads
 * is the trimmed value while what the reporter sees while typing is theirs.
 */
export function trimDraft(draft: ReportDraft): ReportDraft {
  const out: Record<string, unknown> = { ...draft };
  for (const [field, answer] of Object.entries(draft)) {
    if (
      typeof answer === "object" &&
      answer !== null &&
      "status" in answer &&
      answer.status === "answered" &&
      typeof (answer as { value: unknown }).value === "string"
    ) {
      const value = (answer as { value: string }).value.trim();
      out[field] = value.length === 0
        ? { status: "unanswered" }
        : { status: "answered", value };
    }
  }
  return out as ReportDraft;
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

/**
 * The order people tell this story in.
 *
 * It used to run: who this is about, what happened, hospital and emergencies,
 * the medicine, about you. Two things were wrong with that.
 *
 * The medicine came fourth. It is what people LEAD with when they say this out
 * loud — "I took X and then Y happened" — and it is what everything else hangs
 * off, so it is second now.
 *
 * "Hospital and emergencies" was its own step, which made a reporter answer
 * the same question twice in different words: going to hospital IS what
 * happened. Those six questions are folded into "What happened" under "How bad
 * did it get?".
 *
 * That left the dechallenge/rechallenge sequence — did you stop it, did it get
 * better, did you start again, did it come back — buried at the bottom of a
 * ten-question medicine step, where fatigue is highest, with nothing marking
 * it optional. It is the most confusing material in the form, so it is its own
 * step now, explicitly optional and skippable.
 */
export const STEP_IDS = [
  "about",
  "medicine",
  "what_happened",
  "stopping",
  "you",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_TITLES: Readonly<Record<StepId, string>> = {
  about: "Who this is about",
  medicine: "The medicine",
  what_happened: "What happened",
  stopping: "Stopping and starting again",
  you: "About you",
};

/** Steps a reporter may skip outright, and the control says so. */
export const OPTIONAL_STEPS: Readonly<Record<StepId, boolean>> = {
  about: false,
  medicine: false,
  what_happened: false,
  stopping: true,
  you: false,
};

/** Which fields belong to which step. Used for per-step checks and progress. */
export const STEP_FIELDS: Readonly<
  Record<StepId, readonly (keyof ReportDraft)[]>
> = {
  about: ["about", "age", "sex"],
  medicine: [
    "medicineName",
    "takenFor",
    "dose",
    "batchNumber",
    "startedMedicineOn",
  ],
  what_happened: [
    "whatHappened",
    "startedOn",
    "currentState",
    // "How bad did it get?" — the same six questions, in the step they belong
    // to. Going to hospital is part of what happened, not a separate subject.
    "wentToHospital",
    "stayedLongerInHospital",
    "lifeInDanger",
    "lastingProblem",
    "babyHarmed",
    "died",
  ],
  stopping: [
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

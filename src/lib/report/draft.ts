/**
 * One draft, two intakes.
 *
 * The chat and the form ask the same report in two shapes, and until now they
 * shared a schema and shared nothing else — start the chat, get five questions
 * in, find the typing tiring, and the only escape was a form that began empty.
 * Choosing wrong was unrecoverable, which made it the worst failure in the
 * flow. This module is the crossing.
 *
 * `ReportDraft` is the canonical shape: it is what the store holds, what the
 * submit gate validates, and what both surfaces read. `IntakeSlots` is derived
 * from it on the way into the chat and folded back into it on the way out.
 *
 * WHAT DOES NOT SURVIVE THE CROSSING, said plainly because a silent loss would
 * be worse than an asked question:
 *
 *   - The chat's short `reaction` term ("a rash on both hands") has no field on
 *     the form, which asks one free-text question instead of two. Crossing to
 *     the form keeps the longer narrative — the thing the reporter actually
 *     typed most of — and crossing back leaves `reaction` empty, so the chat
 *     asks for it again. That is one repeated question, not lost work.
 *   - `seriousnessEvidence` is character offsets into a narrative a model read.
 *     Offsets into edited text are worse than none, so they are dropped rather
 *     than carried onto a narrative the reporter may since have rewritten.
 *
 * Everything else maps both ways.
 */
import {
  EMPTY_SLOTS,
  type IntakeSlots,
} from "@/lib/intake/conversation";
import {
  EMPTY_DRAFT,
  type CurrentState,
  type ReportDraft,
  type Sex,
} from "@/lib/schemas/report";
import type { SeriousnessCriterion } from "@/lib/schemas";
import { isAnswered, type Answer } from "@/lib/schemas/answer";

/** An answered field, or nothing at all. Keeps the union noise in one place. */
function answered<T>(value: T | null | undefined): Answer<T> {
  return value === null || value === undefined
    ? { status: "unanswered" }
    : { status: "answered", value };
}

function valueOf<T>(field: Answer<T>): T | null {
  return isAnswered(field) ? field.value : null;
}

/**
 * Does this contact detail look like an email?
 *
 * Deliberately crude — one `@` with something either side. The chat asks for
 * "an email address or a phone number" in one box, and the form has two. Any
 * split is a guess; this one is wrong only for input that is not really either,
 * and the reporter can see and correct the result on the very next screen.
 */
function looksLikeEmail(contact: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(contact.trim());
}

/**
 * Which of the six criteria each yes/no question stands for.
 *
 * The form never shows a reporter this list — it asks "Did they have to go to
 * hospital because of this?" and does the mapping here, which is the whole
 * point of the form's wording. `other_medically_important` has no question
 * because no member of the public can be asked to judge it.
 */
const CRITERION_FIELDS: readonly (readonly [
  SeriousnessCriterion,
  keyof ReportDraft,
])[] = [
  ["death", "died"],
  ["life_threatening", "lifeInDanger"],
  ["hospitalisation", "wentToHospital"],
  ["persistent_disability", "lastingProblem"],
  ["congenital_anomaly", "babyHarmed"],
];

/** How the person is now, as the chat's outcome vocabulary. */
const STATE_TO_OUTCOME: Readonly<Record<CurrentState, string>> = {
  better_now: "recovered",
  getting_better: "recovering",
  no_change: "not_recovered",
  worse: "not_recovered",
  died: "fatal",
};

const OUTCOME_TO_STATE: Readonly<Record<string, CurrentState>> = {
  recovered: "better_now",
  recovering: "getting_better",
  not_recovered: "no_change",
  recovered_with_sequelae: "better_now",
  fatal: "died",
};

/**
 * Chat answers, as a form draft.
 *
 * `base` is the draft the reporter already had, so a crossing MERGES rather
 * than replaces: a field the chat never asked about keeps whatever the form
 * knew about it. Only what the chat actually collected is written.
 */
export function draftFromSlots(
  slots: IntakeSlots,
  base: ReportDraft = EMPTY_DRAFT,
): ReportDraft {
  const sex: Sex | null =
    slots.sex === "male" || slots.sex === "female" ? slots.sex : null;

  /*
    The narrative wins over the short reaction term. Both become
    `whatHappened`, which the form turns into BOTH the reaction term and the
    stored narrative — so the longer text is the one worth keeping, and it is
    also the one the reporter spent the most effort on.
  */
  const whatHappened = slots.narrative ?? slots.reaction;

  const contact = slots.reporterContact;
  const email = contact !== null && looksLikeEmail(contact) ? contact : null;
  const phone = contact !== null && !looksLikeEmail(contact) ? contact : null;

  const draft: ReportDraft = {
    ...base,
    ...(whatHappened === null ? {} : { whatHappened: answered(whatHappened) }),
    ...(slots.drug === null ? {} : { medicineName: answered(slots.drug) }),
    ...(slots.age === null ? {} : { age: answered(slots.age) }),
    ...(sex === null ? {} : { sex: answered(sex) }),
    ...(slots.dose === null ? {} : { dose: answered(slots.dose) }),
    ...(slots.reporterName === null
      ? {}
      : { yourName: answered(slots.reporterName) }),
    ...(email === null ? {} : { yourEmail: answered(email) }),
    ...(phone === null ? {} : { yourPhone: answered(phone) }),
    ...(slots.outcome === null || OUTCOME_TO_STATE[slots.outcome] === undefined
      ? {}
      : { currentState: answered(OUTCOME_TO_STATE[slots.outcome]) }),
  };

  /*
    Seriousness. A list the chat collected is a COMPLETE answer to all five
    questions: a criterion in the list is a yes, and one absent from a list
    that exists is a no. "None of those" produces an empty list, which is five
    noes — which is why an empty array must not be treated as no answer.
  */
  if (slots.seriousness === null) return draft;

  const raised = new Set(slots.seriousness);
  const withFlags: Record<string, unknown> = { ...draft };
  for (const [criterion, field] of CRITERION_FIELDS) {
    withFlags[field] = answered(raised.has(criterion) ? "yes" : "no");
  }
  return withFlags as ReportDraft;
}

/**
 * Form answers, as chat slots.
 *
 * The reverse crossing. `reaction` is deliberately absent: the form has no
 * field for it, so the chat asks — one question, rather than a term invented
 * out of a narrative on the reporter's behalf and then attributed to them.
 */
export function slotsFromDraft(draft: ReportDraft): IntakeSlots {
  const answeredCriteria = CRITERION_FIELDS.filter(([, field]) =>
    isAnswered(draft[field] as Answer<unknown>),
  );

  /*
    Only report seriousness when at least one of the five was actually
    answered. Deriving an empty list from five untouched questions would tell
    the chat "none of those happened" on the reporter's behalf, and it would
    then never ask — a fabricated negative on the field that decides whether a
    regulatory clock runs.
  */
  const seriousness =
    answeredCriteria.length === 0
      ? null
      : CRITERION_FIELDS.filter(
          ([, field]) => valueOf(draft[field] as Answer<string>) === "yes",
        ).map(([criterion]) => criterion);

  /*
    The form offers "another way to describe it"; the chat's vocabulary has
    only male, female and unknown. `other` maps to `unknown` rather than being
    dropped — the reporter answered the question, and "unknown" is what this
    system means by "not one of the two it can record".
  */
  const reportedSex = valueOf(draft.sex);
  const sex: IntakeSlots["sex"] =
    reportedSex === "male" || reportedSex === "female"
      ? reportedSex
      : reportedSex === "other"
        ? "unknown"
        : null;

  const state = valueOf(draft.currentState);
  const email = valueOf(draft.yourEmail);
  const phone = valueOf(draft.yourPhone);

  return {
    ...EMPTY_SLOTS,
    narrative: valueOf(draft.whatHappened),
    drug: valueOf(draft.medicineName),
    age: valueOf(draft.age),
    sex,
    seriousness,
    reporterName: valueOf(draft.yourName),
    reporterContact: email ?? phone,
    dose: valueOf(draft.dose),
    outcome: state === null ? null : (STATE_TO_OUTCOME[state] ?? null),
  };
}

/**
 * The answers a saved draft may carry into a fresh conversation — or nothing.
 *
 * A SENT report carries nothing, and that is the whole of this function.
 * `report-draft-store` deliberately exempts a submitted draft from its
 * 24-hour expiry so that reloading the confirmation still shows the reference
 * number; the consequence is that a report sent last week is still in
 * localStorage today. Feeding it to a new conversation put a medicine nobody
 * had named into a new report — "amoxil", against a narrative naming abacavir
 * — and kept doing it, because nothing ever cleared it.
 *
 * The store cannot make this call: it holds the receipt on purpose. The
 * crossing can, and this is where the crossing lives.
 */
export function slotsToCarry(saved: {
  readonly draft: ReportDraft;
  readonly submitted: unknown | null;
}): IntakeSlots | null {
  return saved.submitted === null ? slotsFromDraft(saved.draft) : null;
}

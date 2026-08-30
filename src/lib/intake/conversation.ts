/**
 * Conversational intake for a public side-effect report.
 *
 * WHAT THIS IS, PLAINLY
 * There is no language model wired into this project — no API key, no Workers
 * AI in this session. So the dialogue below is a deterministic slot-filling
 * state machine, not a model. It is written that way on purpose rather than
 * faked: the questions it asks are derived from the four minimum validity
 * criteria in CLAUDE.md, which is exactly what a model would have to be
 * prompted to collect anyway.
 *
 * RETRIEVAL NO LONGER LIVES HERE. It used to: this file searched the corpus
 * itself and composed a sentence from a hit count, which made it the only
 * surface in the system that asserted what a document says with no model
 * having read the passage. That assertion now belongs to the review step
 * (`lib/intake/review.ts` and the chat's Server Action), where a model reads
 * every retrieved passage first and can answer "none of these is about this".
 * What is left here is the part that was always pure: which question comes
 * next, and what the reporter's answers mean.
 *
 * Non-negotiable #4 still governs the outcome: this never decides anything.
 * The reporter is shown what was found and then presses send, and the send
 * control is offered in exactly the same words whatever the reading said.
 */
import type { Citation, SeriousnessCriterion } from "@/lib/schemas";
import { SERIOUSNESS_CRITERIA } from "@/lib/schemas";
import type { Extraction, SeriousnessEvidence } from "@/lib/extract/schema";

export type IntakeSlot =
  | "narrative"
  | "drug"
  | "reaction"
  | "age"
  | "sex"
  | "seriousness"
  | "reporterName"
  | "reporterContact";

export interface IntakeSlots {
  readonly narrative: string | null;
  readonly drug: string | null;
  readonly reaction: string | null;
  readonly age: number | null;
  readonly sex: "male" | "female" | "unknown" | null;
  readonly seriousness: readonly SeriousnessCriterion[] | null;
  readonly reporterName: string | null;
  readonly reporterContact: string | null;
  /**
   * Fields only a model reads, and the phrases behind any seriousness it
   * raised. Empty on the fallback path, which is why every one of these is
   * nullable and nothing downstream may require them.
   */
  readonly dose: string | null;
  readonly route: string | null;
  readonly outcome: string | null;
  readonly therapyStart: string | null;
  readonly therapyEnd: string | null;
  readonly reactionOnset: string | null;
  /**
   * The exact words in the narrative that carried each seriousness criterion.
   * This is what a regex cannot produce, and what turns a `declared` flag into
   * a `narrative` one with a span a reviewer can see highlighted.
   */
  readonly seriousnessEvidence: readonly SeriousnessEvidence[];
}

export const EMPTY_SLOTS: IntakeSlots = {
  narrative: null,
  drug: null,
  reaction: null,
  age: null,
  sex: null,
  seriousness: null,
  reporterName: null,
  reporterContact: null,
  dose: null,
  route: null,
  outcome: null,
  therapyStart: null,
  therapyEnd: null,
  reactionOnset: null,
  seriousnessEvidence: [],
};

export interface IntakeMessage {
  readonly role: "assistant" | "reporter";
  readonly text: string;
  /** Passages behind this message. Empty unless the message makes a claim. */
  readonly citations: readonly Citation[];
}

/**
 * Answers an earlier page already knew, as the TEXT a reply would contain.
 *
 * Text rather than parsed values, and that is the whole design. A suggestion
 * the reporter accepts is typed into the same box and parsed by the same
 * `parseAgeAnswer` / `extractSex` / `extractSeriousness` as one they type
 * themselves — the invariant `quick-answers.tsx` already states about its own
 * options. A parsed prefill would be a second way for an answer to enter the
 * record, and second ways are how the two halves come to disagree.
 */
export type IntakePrefill = Readonly<Partial<Record<IntakeSlot, string>>>;

export interface IntakeState {
  readonly messages: readonly IntakeMessage[];
  /** Answers given IN THIS CONVERSATION. Nothing else ever writes here. */
  readonly slots: IntakeSlots;
  /**
   * What a previous page thought it knew, offered as one-tap suggestions.
   *
   * Kept rigidly apart from `slots`, because merging the two is what filed a
   * report against the wrong medicine. A form draft carrying "amoxil" was
   * folded into `slots` on the first turn; `nextMissing` then found nothing
   * missing and the conversation ended after one question, filing amoxil
   * against a narrative that named abacavir. A submitted draft never expires,
   * so that value would have led every future conversation too.
   *
   * A suggestion is not an answer. It is asked about like everything else.
   */
  readonly prefill: IntakePrefill;
  /** The slot the last assistant question was asking about. */
  readonly pending: IntakeSlot | null;
  /**
   * `review` is the state in which everything has been collected and NOTHING
   * has been written. The reporter reads what was found and what will be
   * filed, and presses send — or changes an answer, which returns here.
   */
  readonly phase: "collecting" | "review" | "complete";
  /**
   * True once the conversation has reached review at least once.
   *
   * The progress readout needs it. Answering the eight questions and
   * correcting one of them are both `collecting` with one slot outstanding,
   * and the count cannot tell them apart — so a reporter re-asked for the
   * medicine was told "Question 8 of 8" above the second question in the
   * script. A count of what is left is the wrong readout for a correction.
   */
  readonly reviewed: boolean;
}

const OPENING =
  "Tell me what happened, in your own words. Who is it about, what went wrong, and which medicine were they taking? You can write it however you like.";

const CLOSING =
  "That is everything I need. Nothing has been sent yet — below is what I found in the published information for that medicine, and exactly what I am about to file. Read it, change anything that is wrong, and send it when you are ready.";

export function startConversation(prefill: IntakePrefill = {}): IntakeState {
  return {
    messages: [{ role: "assistant", text: OPENING, citations: [] }],
    slots: EMPTY_SLOTS,
    prefill,
    pending: "narrative",
    phase: "collecting",
    reviewed: false,
  };
}

// ---------------------------------------------------------------------------
// Interpretation — the part a model would replace
// ---------------------------------------------------------------------------

const SEX_PATTERNS: readonly (readonly [RegExp, "male" | "female"])[] = [
  [/\b(male|man|men|boy|he|him|his|husband|father|son|brother)\b/i, "male"],
  [/\b(female|woman|women|girl|she|her|wife|mother|daughter|sister)\b/i, "female"],
];

/**
 * Ages written the way people actually write them.
 *
 * Note `years?` — the first draft omitted the plural and silently failed on
 * "45 years old", which is how most people write it. Caught by the tests.
 */
const AGE_PATTERNS: readonly RegExp[] = [
  /\b(\d{1,3})\s*[-\s]?\s*years?[\s-]*old\b/i,
  /\baged?\s+(\d{1,3})\b/i,
  /\b(\d{1,3})\s*(?:yo|y\/o|yrs?)\b/i,
];

export function extractAge(text: string): number | null {
  for (const pattern of AGE_PATTERNS) {
    const match = pattern.exec(text);
    const raw = match?.[1];
    if (raw !== undefined) {
      const age = Number(raw);
      if (Number.isFinite(age) && age >= 0 && age <= 130) return age;
    }
  }
  // A bare number, but only when the whole reply is that number — otherwise
  // "20mg twice a day" becomes a 20-year-old.
  const bare = /^\s*(\d{1,3})\s*$/.exec(text);
  const raw = bare?.[1];
  if (raw !== undefined) {
    const age = Number(raw);
    if (age >= 0 && age <= 130) return age;
  }
  return null;
}

export function extractSex(text: string): "male" | "female" | "unknown" | null {
  if (/\b(don'?t know|not sure|unknown|prefer not)\b/i.test(text)) return "unknown";
  for (const [pattern, value] of SEX_PATTERNS) {
    if (pattern.test(text)) return value;
  }
  return null;
}

/**
 * Parse a reply to a direct "how old are they?" question.
 *
 * Deliberately more permissive than extractAge. Opportunistic extraction from
 * free prose has to be cautious — "20mg twice a day" must not become a
 * 20-year-old. But when the question just asked was about age, any plain
 * number in the reply is the answer, and "she is 34" is a perfectly normal way
 * to give it. Context changes what is safe to assume, so the two cases get two
 * functions rather than one compromise.
 */
export function parseAgeAnswer(text: string): number | null {
  const direct = extractAge(text);
  if (direct !== null) return direct;
  const any = /\b(\d{1,3})\b/.exec(text);
  const raw = any?.[1];
  if (raw === undefined) return null;
  const age = Number(raw);
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * Find a medicine the reporter named, by matching against the substances and
 * brands already in the library.
 *
 * Matching against known products rather than guessing at any capitalised word
 * is what keeps this from "extracting" the reporter's surname as a drug. The
 * cost is that an unknown product is not recognised — so the flow asks, rather
 * than inventing.
 */
export function extractDrug(
  text: string,
  knownProducts: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  const hits = knownProducts
    .filter((product) => product.length > 2 && lower.includes(product.toLowerCase()))
    // Longest match wins: "Hepalex XR" beats "Hepalex".
    .sort((a, b) => b.length - a.length);
  return hits[0] ?? null;
}

const SERIOUSNESS_KEYWORDS: Readonly<Record<SeriousnessCriterion, RegExp>> = {
  death: /\b(died|death|passed away|fatal)\b/i,
  life_threatening: /\b(life[\s-]?threatening|nearly died|life was in danger|intensive care|resuscitat)\w*/i,
  hospitalisation: /\b(hospital|admitted|a&e|emergency room|\ber\b|inpatient|overnight)\b/i,
  persistent_disability: /\b(disabilit|disabled|permanent|lasting damage|never recovered)\w*/i,
  congenital_anomaly: /\b(birth defect|congenital|born with)\b/i,
  other_medically_important: /\b(serious|severe|urgent)\b/i,
};

export function extractSeriousness(
  text: string,
): readonly SeriousnessCriterion[] {
  if (/\b(no|none|nothing|neither)\b/i.test(text.trim()) && text.trim().length < 24) {
    return [];
  }
  return SERIOUSNESS_CRITERIA.filter((criterion) =>
    SERIOUSNESS_KEYWORDS[criterion].test(text),
  );
}

/**
 * Everything we can pull from one free-text message.
 *
 * The deterministic half is unchanged and is the floor: whatever the model
 * does or does not manage, these three still run. `extraction` is layered on
 * top when a model produced a verified one, and is simply absent otherwise —
 * which is the whole of the fallback. There is no third code path to keep in
 * step, and no partially-merged record that neither path is responsible for.
 *
 * The model wins where both have an opinion. It has read the whole sentence;
 * the regexes have matched a token. Where the model returned null the regex
 * value stands, so a model that fills nothing costs nothing.
 */
function interpret(
  text: string,
  slots: IntakeSlots,
  knownProducts: readonly string[],
  extraction: Extraction | null,
): IntakeSlots {
  const withPatterns: IntakeSlots = {
    ...slots,
    drug: slots.drug ?? extractDrug(text, knownProducts),
    age: slots.age ?? extractAge(text),
    sex: slots.sex ?? extractSex(text),
  };

  if (extraction === null) return withPatterns;

  /*
    THE REPORTER'S OWN WORDS WIN. Every time, on every field.

    `drug`, `age` and `sex` used to read `extraction.x ?? withPatterns.x` — the
    model first, the person second — while `reaction` alone read the other way
    round. That inversion filed a real report against the wrong medicine.

    A reporter wrote "after i had my coronovirus injection i feel dizzy" and
    later typed "moderna coronovirus injection" when asked which medicine. The
    model, whose prompt lists the products this library holds, answered
    `suspectDrug: "Covaxil"` — the nearest-sounding demo product, and not a
    medicine the reporter had ever mentioned. Because the model went first,
    that is what the case was filed under: a Moderna vaccine report recorded
    against an unrelated drug, corrupting the safety signal for both.

    This is non-negotiable #4 at its plainest. The model may fill a gap the
    reporter left; it may never overwrite an answer the reporter gave. `??`
    with the person on the left says exactly that, and it is the same shape
    `reaction` always had.
  */
  return {
    ...withPatterns,
    drug: withPatterns.drug ?? extraction.suspectDrug,
    reaction: withPatterns.reaction ?? extraction.reaction,
    age: withPatterns.age ?? extraction.patientAgeYears,
    sex: withPatterns.sex ?? extraction.patientSex,
    dose: extraction.dose ?? withPatterns.dose,
    route: extraction.route ?? withPatterns.route,
    outcome: extraction.outcome ?? withPatterns.outcome,
    therapyStart: extraction.therapyStart ?? withPatterns.therapyStart,
    therapyEnd: extraction.therapyEnd ?? withPatterns.therapyEnd,
    reactionOnset: extraction.reactionOnset ?? withPatterns.reactionOnset,
    // Only ever added to, never used to clear a criterion the reporter
    // answered directly. A model that reads no hospitalisation into a
    // narrative has not contradicted a reporter who ticked the box.
    seriousnessEvidence:
      extraction.seriousness.length > 0
        ? extraction.seriousness
        : withPatterns.seriousnessEvidence,
  };
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

/** Asked in this order. Drug and reaction first: without them there is no case. */
const ORDER: readonly IntakeSlot[] = [
  "drug",
  "reaction",
  "age",
  "sex",
  "seriousness",
  "reporterName",
  "reporterContact",
];

/**
 * How many questions the intake asks: the opening narrative, plus one per slot
 * in ORDER. Derived rather than typed, so a slot added above cannot leave the
 * progress readout quietly counting to the wrong number.
 */
export const INTAKE_QUESTION_COUNT = ORDER.length + 1;

const QUESTIONS: Readonly<Record<IntakeSlot, string>> = {
  narrative: OPENING,
  drug:
    "Which medicine were they taking? The name on the box is enough — I could not pick one out of what you wrote.",
  reaction:
    "In a few words, what would you call what went wrong? For example “a rash on both hands”.",
  age: "How old is the person this happened to? An approximate age is fine.",
  sex: "Are they male or female? Say “prefer not to say” if you would rather not.",
  seriousness:
    "Did any of these happen? They went into hospital, their life was in danger, they were left with a lasting disability, a baby was born with a problem, or they died. Say “none of those” if none did.",
  reporterName: "What is your name?",
  reporterContact:
    "And an email address or phone number, in case a reviewer needs to ask you one more thing.",
};

/**
 * One phrase per criterion, in words `extractSeriousness` recognises.
 *
 * The canonical list, exported, because there are now two places that need to
 * turn a criterion back into something a reporter could have typed: the quick
 * answer chips and the prefill below. Two copies of these strings would be two
 * chances for a phrase to stop matching the regex it is meant to trip, and the
 * failure would be silent — a tapped chip that fills nothing.
 */
export const SERIOUSNESS_PHRASES: Readonly<
  Record<SeriousnessCriterion, string>
> = {
  death: "they died",
  life_threatening: "their life was in danger",
  hospitalisation: "they went into hospital",
  persistent_disability: "they were left with a lasting disability",
  congenital_anomaly: "a baby was born with a birth defect",
  other_medically_important: "it was serious",
};

/** What "none of those" is, in the one place both the chips and prefill read. */
export const NO_SERIOUSNESS = "none of those";

/**
 * Answers another page already holds, as suggested reply text.
 *
 * Every value here is round-tripped through this module's own parsers when the
 * reporter accepts it, so a suggestion that would not parse is a bug this
 * function is responsible for — which is why the seriousness phrases come from
 * the map above rather than being written out again.
 */
export function prefillFromSlots(slots: IntakeSlots): IntakePrefill {
  const prefill: Record<string, string> = {};
  if (slots.narrative !== null) prefill["narrative"] = slots.narrative;
  if (slots.drug !== null) prefill["drug"] = slots.drug;
  if (slots.reaction !== null) prefill["reaction"] = slots.reaction;
  if (slots.age !== null) prefill["age"] = String(slots.age);
  if (slots.sex !== null) {
    prefill["sex"] = slots.sex === "unknown" ? "prefer not to say" : slots.sex;
  }
  if (slots.seriousness !== null) {
    prefill["seriousness"] =
      slots.seriousness.length === 0
        ? NO_SERIOUSNESS
        : slots.seriousness
            .map((criterion) => SERIOUSNESS_PHRASES[criterion])
            .join(", and ");
  }
  if (slots.reporterName !== null) prefill["reporterName"] = slots.reporterName;
  if (slots.reporterContact !== null) {
    prefill["reporterContact"] = slots.reporterContact;
  }
  return prefill;
}

function nextMissing(slots: IntakeSlots): IntakeSlot | null {
  for (const slot of ORDER) {
    if (slot === "seriousness") {
      if (slots.seriousness === null) return slot;
      continue;
    }
    if (slots[slot] === null) return slot;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export interface AdvanceInput {
  readonly state: IntakeState;
  readonly reply: string;
  /** Substance and brand names already in the library, for drug matching. */
  readonly knownProducts: readonly string[];
  /**
   * A verified model extraction of this message, when one was produced.
   *
   * Passed in rather than fetched, so `advance` stays pure and the whole
   * conversation remains testable without a network. Null is the ordinary
   * case, not an error case: it is what every fallback path supplies.
   */
  readonly extraction?: Extraction | null | undefined;
}

/**
 * Apply one reporter message and produce the next assistant turn.
 *
 * Pure, and now pure in a stronger sense than before: it takes no corpus, no
 * scope and no audience, because it no longer searches anything. Given the
 * same state and reply it always produces the same next state, which is what
 * makes the whole conversation testable without a browser or a network.
 */
export function advance(input: AdvanceInput): IntakeState {
  const { state, reply, knownProducts } = input;
  const trimmed = reply.trim();
  if (trimmed.length === 0 || state.phase !== "collecting") return state;

  const reporterMessage: IntakeMessage = {
    role: "reporter",
    text: trimmed,
    citations: [],
  };

  // Fill the slot we asked about, then opportunistically read anything else
  // the reply happened to contain.
  let slots = state.slots;
  switch (state.pending) {
    case "narrative":
      slots = { ...slots, narrative: trimmed };
      break;
    case "drug":
      slots = { ...slots, drug: trimmed };
      break;
    case "reaction":
      slots = { ...slots, reaction: trimmed };
      break;
    case "age":
      slots = { ...slots, age: parseAgeAnswer(trimmed) };
      break;
    case "sex":
      slots = { ...slots, sex: extractSex(trimmed) ?? "unknown" };
      break;
    case "seriousness":
      slots = { ...slots, seriousness: extractSeriousness(trimmed) };
      break;
    case "reporterName":
      slots = { ...slots, reporterName: trimmed };
      break;
    case "reporterContact":
      slots = { ...slots, reporterContact: trimmed };
      break;
    case null:
      break;
  }
  slots = interpret(trimmed, slots, knownProducts, input.extraction ?? null);

  // An unparseable answer to a specific question must not be silently dropped;
  // ask again rather than moving on with a null.
  if (state.pending === "age" && slots.age === null) {
    return {
      ...state,
      slots,
      messages: [
        ...state.messages,
        reporterMessage,
        {
          role: "assistant",
          citations: [],
          text: "Sorry — I need that as a number of years. Roughly how old are they?",
        },
      ],
    };
  }

  const missing = nextMissing(slots);
  if (missing !== null) {
    return {
      ...state,
      slots,
      pending: missing,
      messages: [
        ...state.messages,
        reporterMessage,
        { role: "assistant", text: QUESTIONS[missing], citations: [] },
      ],
    };
  }

  /*
    Everything is collected, and nothing is written.

    This branch used to compose a verdict AND the caller used to store the case
    in the same turn — the reporter read "does appear in the published
    information" and their reference number in one render, with the reply form
    already gone. There was no step to drop out of, which is what made the
    unread assertion tolerable. Now there is a step, so the assertion has to be
    earned: the Server Action retrieves and hands the passages to a model
    before anything is claimed, and the reporter presses send.
  */
  return {
    ...state,
    slots,
    pending: null,
    phase: "review",
    reviewed: true,
    messages: [
      ...state.messages,
      reporterMessage,
      { role: "assistant", text: CLOSING, citations: [] },
    ],
  };
}

/**
 * Ask one question again, from the review screen.
 *
 * Returns to `collecting` with exactly one slot cleared, so `nextMissing`
 * finds that slot and only that slot — answering it lands straight back in
 * review. Clearing rather than leaving the old value in place is what makes
 * the returned state honest: while the question stands unanswered, the record
 * does not claim an answer.
 */
export function reopen(state: IntakeState, slot: IntakeSlot): IntakeState {
  if (state.phase !== "review") return state;

  const cleared: IntakeSlots =
    slot === "narrative"
      ? { ...state.slots, narrative: null }
      : { ...state.slots, [slot]: null };

  return {
    ...state,
    slots: cleared,
    pending: slot,
    phase: "collecting",
    messages: [
      ...state.messages,
      { role: "assistant", text: QUESTIONS[slot], citations: [] },
    ],
  };
}

/** What the reporter still has to supply, for the progress readout. */
export function remainingSlots(slots: IntakeSlots): readonly IntakeSlot[] {
  return ORDER.filter((slot) =>
    slot === "seriousness" ? slots.seriousness === null : slots[slot] === null,
  );
}

/**
 * The order the review lists answers in, and the only list of slots a caller
 * outside this module should iterate. `narrative` first because it is what the
 * reporter actually wrote; the rest as they were asked.
 */
export const REVIEW_ORDER: readonly IntakeSlot[] = ["narrative", ...ORDER];

/** The question behind one slot, for a screen that offers to re-ask it. */
export function questionFor(slot: IntakeSlot): string {
  return QUESTIONS[slot];
}

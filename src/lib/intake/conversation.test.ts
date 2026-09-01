import { describe, expect, it } from "vitest";
import {
  EMPTY_SLOTS,
  INTAKE_QUESTION_COUNT,
  advance,
  extractAge,
  extractDrug,
  extractSeriousness,
  extractSex,
  intakeProgress,
  prefillFromSlots,
  remainingSlots,
  reopen,
  startConversation,
  type IntakeState,
} from "./conversation";

const PRODUCTS = ["Hepalex", "hepalexin", "Covaxil", "covaxilin", "Dermacil"];

const step = (state: IntakeState, reply: string) =>
  advance({ state, reply, knownProducts: PRODUCTS });

const lastAssistant = (state: IntakeState) =>
  [...state.messages].reverse().find((m) => m.role === "assistant")?.text ?? "";

describe("extraction", () => {
  it("reads ages the way people write them", () => {
    expect(extractAge("she is 45 years old")).toBe(45);
    expect(extractAge("aged 7")).toBe(7);
    expect(extractAge("62yo")).toBe(62);
    expect(extractAge("  38 ")).toBe(38);
  });

  it("does not mistake a dose for an age", () => {
    expect(extractAge("20mg twice a day")).toBeNull();
  });

  it("reads sex from ordinary wording", () => {
    expect(extractSex("my husband")).toBe("male");
    expect(extractSex("she had a rash")).toBe("female");
    expect(extractSex("I would prefer not to say")).toBe("unknown");
    expect(extractSex("the tablets")).toBeNull();
  });

  it("matches a medicine only against known products", () => {
    expect(extractDrug("they were given Hepalex", PRODUCTS)).toBe("Hepalex");
    expect(extractDrug("prescribed by Dr Hepworth", PRODUCTS)).toBeNull();
  });

  it("reads seriousness from plain words", () => {
    expect(extractSeriousness("he was admitted to hospital")).toContain(
      "hospitalisation",
    );
    expect(extractSeriousness("none of those")).toEqual([]);
  });
});

describe("the conversation", () => {
  it("opens by asking what happened", () => {
    const state = startConversation();
    expect(state.pending).toBe("narrative");
    expect(state.messages).toHaveLength(1);
  });

  it("handles the clinician's opening message from the brief", () => {
    // "I have a patient in front of me and have rash on both hands after
    // getting the coronavirus drug."
    const opened = step(
      startConversation(),
      "I have a patient in front of me with a rash on both hands after getting the Covaxil coronavirus drug.",
    );

    // It picked the medicine out, so it must not ask for it again.
    expect(opened.slots.drug).toBe("Covaxil");
    expect(opened.slots.narrative).toContain("rash on both hands");
    // It does not know the reaction term, age or sex yet.
    expect(remainingSlots(opened.slots)).toContain("age");
    expect(remainingSlots(opened.slots)).toContain("sex");
  });

  it("asks for the age and then the sex, as the brief describes", () => {
    let state = step(
      startConversation(),
      "Patient has a rash on both hands after the Covaxil coronavirus drug.",
    );
    state = step(state, "a rash on both hands");
    expect(lastAssistant(state)).toMatch(/how old/i);
    state = step(state, "she is 34");
    expect(state.slots.age).toBe(34);
    // Sex was already readable from "she", so it moves on rather than asking.
    expect(state.slots.sex).toBe("female");
    expect(lastAssistant(state)).toMatch(/hospital|life was in danger/i);
  });

  it("asks again rather than accepting an unusable age", () => {
    let state = step(startConversation(), "rash after Covaxil");
    state = step(state, "a rash");
    const before = state.messages.length;
    state = step(state, "not sure really");
    expect(state.slots.age).toBeNull();
    expect(lastAssistant(state)).toMatch(/number of years/i);
    expect(state.messages.length).toBeGreaterThan(before);
  });

  it("reaches review once everything is collected, and files nothing", () => {
    let state = step(startConversation(), "Rash on both hands after Covaxil.");
    state = step(state, "rash on both hands");
    state = step(state, "34");
    state = step(state, "female");
    state = step(state, "none of those");
    state = step(state, "Dr A Weber");
    state = step(state, "a.weber@example.org");

    // `review`, not `complete`. The case is written by the Server Action when
    // the reporter presses send, and by nothing else.
    expect(state.phase).toBe("review");
    expect(remainingSlots(state.slots)).toEqual([]);
    expect(lastAssistant(state)).toMatch(/nothing has been sent yet/i);
  });

  it("ignores an empty reply", () => {
    const state = startConversation();
    expect(step(state, "   ")).toBe(state);
  });

  it("stops accepting typed answers once the questions are done", () => {
    let state = step(startConversation(), "Rash after Covaxil.");
    state = step(state, "rash");
    state = step(state, "34");
    state = step(state, "female");
    state = step(state, "none");
    state = step(state, "A Weber");
    state = step(state, "a@example.org");
    // In review, the way to change something is the change control, which
    // goes through `reopen` — not another message into the box.
    expect(state.phase).toBe("review");
    expect(step(state, "one more thing")).toBe(state);
  });
});

describe("a carried answer is a suggestion, not an answer", () => {
  /*
    THE AMOXIL BUG, as a test. A form report submitted days earlier sat in
    localStorage — a submitted draft is deliberately exempt from the 24-hour
    expiry — and was merged into `slots` on the first turn. Every slot was then
    full, so the conversation ended after one question and filed a case against
    "amoxil" over a narrative that named abacavir. Nothing the reporter typed
    was ever consulted, and nothing was shown back to them.
  */
  const carried = prefillFromSlots({
    ...EMPTY_SLOTS,
    drug: "amoxil",
    age: 37,
    sex: "male",
    seriousness: [],
    reporterName: "john doe",
    reporterContact: "johndoe3@gmail.com",
  });

  it("still asks every question", () => {
    const state = step(
      startConversation(carried),
      "i took ABACAVIR SULFATE and i have a big headache",
    );

    expect(state.phase).toBe("collecting");
    // Not one of the carried values reached the record by arriving.
    expect(state.slots.drug).toBeNull();
    expect(state.slots.reporterName).toBeNull();
    expect(remainingSlots(state.slots)).toEqual([
      "drug",
      "reaction",
      "age",
      "sex",
      "seriousness",
      "reporterName",
      "reporterContact",
    ]);
  });

  it("loses to the medicine the reporter types", () => {
    let state = step(startConversation(carried), "i had a bad headache");
    state = step(state, "abacavir sulfate");
    expect(state.slots.drug).toBe("abacavir sulfate");
  });

  it("offers text its own parsers accept", () => {
    // The suggestion is round-tripped: whatever it says must parse back to the
    // value it came from, or a tapped chip fills nothing and says nothing.
    const prefill = prefillFromSlots({
      ...EMPTY_SLOTS,
      age: 37,
      sex: "unknown",
      seriousness: ["hospitalisation", "death"],
    });
    expect(extractAge(prefill.age ?? "")).toBe(37);
    expect(extractSex(prefill.sex ?? "")).toBe("unknown");
    expect(extractSeriousness(prefill.seriousness ?? "")).toEqual([
      "death",
      "hospitalisation",
    ]);
    expect(extractSeriousness(prefillFromSlots({ ...EMPTY_SLOTS, seriousness: [] }).seriousness ?? "")).toEqual([]);
  });
});

describe("changing an answer from the review screen", () => {
  const collected = () => {
    let state = step(startConversation(), "Rash on both hands after Covaxil.");
    state = step(state, "rash on both hands");
    state = step(state, "34");
    state = step(state, "female");
    state = step(state, "none of those");
    state = step(state, "A Weber");
    state = step(state, "a@example.org");
    return state;
  };

  it("re-asks exactly one question and returns to review when it is answered", () => {
    const reopened = reopen(collected(), "drug");
    expect(reopened.phase).toBe("collecting");
    expect(reopened.pending).toBe("drug");
    // Cleared, not merely re-asked: while the question stands unanswered the
    // record does not claim an answer.
    expect(reopened.slots.drug).toBeNull();
    expect(remainingSlots(reopened.slots)).toEqual(["drug"]);

    const answered = step(reopened, "Hepalex");
    expect(answered.slots.drug).toBe("Hepalex");
    expect(answered.phase).toBe("review");
  });

  it("keeps every other answer", () => {
    const answered = step(reopen(collected(), "age"), "51");
    expect(answered.slots.age).toBe(51);
    expect(answered.slots.reporterName).toBe("A Weber");
    expect(answered.slots.reaction).toBe("rash on both hands");
  });

  it("does nothing while the reporter is still answering questions", () => {
    const midway = step(startConversation(), "Rash after Covaxil.");
    expect(reopen(midway, "drug")).toBe(midway);
  });
});

describe("the reporter's answer always beats the model's", () => {
  /*
    A real report was filed against the wrong drug by this. The reporter wrote
    about a coronavirus injection and typed "moderna coronovirus injection"
    when asked which medicine; the extraction model — whose prompt lists the
    products this library holds — answered "Covaxil", the nearest-sounding demo
    product, and won. A Moderna report was recorded against an unrelated
    medicine.
  */
  const extraction = {
    suspectDrug: "Covaxil",
    reaction: "rash",
    patientAgeYears: 99,
    patientSex: "female" as const,
    dose: null,
    route: null,
    outcome: null,
    therapyStart: null,
    therapyEnd: null,
    reactionOnset: null,
    seriousness: [],
    seriousnessEvidence: [],
    model: "test-model",
    gatewayRequestId: null,
    generatedAt: "2026-08-28T00:00:00.000Z",
  };

  it("keeps the medicine the reporter named", () => {
    const state = advance({
      state: { ...startConversation(), pending: "drug" as const },
      reply: "moderna coronovirus injection",
      knownProducts: PRODUCTS,
      extraction,
    });
    expect(state.slots.drug).toBe("moderna coronovirus injection");
    expect(state.slots.drug).not.toBe("Covaxil");
  });

  it("keeps the age and sex the reporter gave", () => {
    const aged = advance({
      state: { ...startConversation(), pending: "age" as const },
      reply: "37",
      knownProducts: PRODUCTS,
      extraction,
    });
    expect(aged.slots.age).toBe(37);
  });

  it("still lets the model fill a gap the reporter left", () => {
    // Suggesting into an empty slot is the job. Overwriting an answer is not.
    const state = advance({
      state: { ...startConversation(), pending: "narrative" as const },
      reply: "I took something and came out in a rash",
      knownProducts: PRODUCTS,
      extraction,
    });
    expect(state.slots.drug).toBe("Covaxil");
  });
});


/**
 * THE COUNTER, WHICH HAS NOW BEEN WRONG TWICE IN OPPOSITE DIRECTIONS.
 *
 * Once it read "Question 8 of 8" above the second question of a correction.
 * Then, on a fresh chat with nothing answered, it read "QUESTION 2 OF 8" above
 * question 1 — live on the deployed app.
 *
 * Both times the cause was the same shape rather than the same sign: a number
 * derived from one set and read against another's total. The screen computed
 * `INTAKE_QUESTION_COUNT - remainingSlots(slots).length`, and those two do not
 * count the same questions — the constant includes the opening account, and
 * `remainingSlots` filters ORDER, which does not. 8 - 7 = 1 answered before
 * anybody had answered anything.
 *
 * These assert the derivation, not the offset. Fixing an offset a third time
 * would leave the next person exactly where the last two were.
 */
describe("where the reporter is in the script", () => {
  it("is question 1 of 8 before anything has been answered", () => {
    const progress = intakeProgress(EMPTY_SLOTS);
    expect(progress.answered).toBe(0);
    expect(progress.current).toBe(1);
    expect(progress.total).toBe(INTAKE_QUESTION_COUNT);
  });

  it("counts the opening account as the first question answered", () => {
    const after = step(startConversation(), "My mother took Hepalex and her eyes went yellow.");
    const progress = intakeProgress(after.slots);
    // The opening turn IS a question, and the total has always said so. What
    // it must not do is count as answered before it is given.
    expect(progress.answered).toBeGreaterThanOrEqual(1);
    expect(progress.current).toBe(progress.answered + 1);
  });

  it("never counts past the last question", () => {
    const answered = {
      ...EMPTY_SLOTS,
      narrative: "n",
      drug: "Hepalex",
      reaction: "jaundice",
      age: 61,
      sex: "female" as const,
      seriousness: [],
      reporterName: "R. Patel",
      reporterContact: "r@example.com",
    };
    const progress = intakeProgress(answered);
    expect(progress.answered).toBe(INTAKE_QUESTION_COUNT);
    // Not 9 of 8.
    expect(progress.current).toBe(INTAKE_QUESTION_COUNT);
  });

  /*
    THE MISMATCH ITSELF, PINNED — because the tempting invariant is false and
    believing it is what produced the bug.

    `answered + remainingSlots.length === total` looks like it should always
    hold. It does not, and must not: `remainingSlots` drives `nextMissing` and
    the checklist chips, so it filters ORDER and deliberately leaves out the
    opening account, which is asked before there is anything to be missing.

    The two agree ONLY once the narrative is in. Before that the gap is exactly
    one — the unanswered opening question — and reading `remainingSlots`
    against `INTAKE_QUESTION_COUNT` turned that gap into a phantom answer.
  */
  it("differs from what is outstanding by exactly the opening question", () => {
    const fresh = intakeProgress(EMPTY_SLOTS);
    expect(fresh.answered + remainingSlots(EMPTY_SLOTS).length).toBe(
      INTAKE_QUESTION_COUNT - 1,
    );

    const started = { ...EMPTY_SLOTS, narrative: "n", drug: "Hepalex" };
    expect(
      intakeProgress(started).answered + remainingSlots(started).length,
    ).toBe(INTAKE_QUESTION_COUNT);
  });
});

/**
 * The crossing between the two intakes.
 *
 * The claim these exist to defend is the acceptance criterion in the brief: a
 * reporter five questions into the chat switches to the form and finds their
 * answers already there. Everything else here guards against the two ways that
 * could go wrong quietly — losing an answer, or inventing one.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_SLOTS, type IntakeSlots } from "@/lib/intake/conversation";
import { EMPTY_DRAFT, type ReportDraft } from "@/lib/schemas/report";
import { draftFromSlots, slotsFromDraft } from "./draft";

const slots = (over: Partial<IntakeSlots>): IntakeSlots => ({
  ...EMPTY_SLOTS,
  ...over,
});

const answered = <T,>(value: T) => ({ status: "answered" as const, value });

describe("chat answers become form answers", () => {
  it("carries five questions of work across", () => {
    const draft = draftFromSlots(
      slots({
        narrative: "She came out in a rash on both arms two days after starting it.",
        drug: "Amoxil",
        age: 61,
        sex: "female",
        reporterName: "J. Rivera",
        reporterContact: "j.rivera@example.com",
      }),
    );

    expect(draft.whatHappened).toEqual(
      answered("She came out in a rash on both arms two days after starting it."),
    );
    expect(draft.medicineName).toEqual(answered("Amoxil"));
    expect(draft.age).toEqual(answered(61));
    expect(draft.sex).toEqual(answered("female"));
    expect(draft.yourName).toEqual(answered("J. Rivera"));
    expect(draft.yourEmail).toEqual(answered("j.rivera@example.com"));
  });

  it("puts a phone number in the phone field, not the email one", () => {
    const draft = draftFromSlots(slots({ reporterContact: "+44 7700 900123" }));
    expect(draft.yourPhone).toEqual(answered("+44 7700 900123"));
    expect(draft.yourEmail.status).toBe("unanswered");
  });

  /*
    A seriousness list is a complete answer to all five questions: what is in
    it is a yes, what is absent from a list that EXISTS is a no. An empty list
    is "none of those" — five noes — which is why it must not be mistaken for
    no answer at all.
  */
  it("turns a raised criterion into yes and an unraised one into no", () => {
    const draft = draftFromSlots(
      slots({ seriousness: ["hospitalisation", "life_threatening"] }),
    );
    expect(draft.wentToHospital).toEqual(answered("yes"));
    expect(draft.lifeInDanger).toEqual(answered("yes"));
    expect(draft.died).toEqual(answered("no"));
    expect(draft.lastingProblem).toEqual(answered("no"));
    expect(draft.babyHarmed).toEqual(answered("no"));
  });

  it("treats an empty list as five noes, not as silence", () => {
    const draft = draftFromSlots(slots({ seriousness: [] }));
    expect(draft.wentToHospital).toEqual(answered("no"));
    expect(draft.died).toEqual(answered("no"));
  });

  it("leaves all five unanswered when the chat never asked", () => {
    const draft = draftFromSlots(slots({ drug: "Amoxil" }));
    expect(draft.wentToHospital.status).toBe("unanswered");
    expect(draft.died.status).toBe("unanswered");
  });

  /*
    A crossing merges. A field the chat never asks about — the batch number,
    say — must survive the trip rather than being reset to blank by a spread.
  */
  it("keeps what the form already knew and the chat never asks", () => {
    const base: ReportDraft = {
      ...EMPTY_DRAFT,
      batchNumber: answered("ABC-123"),
      country: answered("United Kingdom"),
    };
    const draft = draftFromSlots(slots({ drug: "Amoxil" }), base);
    expect(draft.batchNumber).toEqual(answered("ABC-123"));
    expect(draft.country).toEqual(answered("United Kingdom"));
    expect(draft.medicineName).toEqual(answered("Amoxil"));
  });

  it("prefers the narrative over the short reaction term", () => {
    const draft = draftFromSlots(
      slots({ narrative: "The long version.", reaction: "rash" }),
    );
    expect(draft.whatHappened).toEqual(answered("The long version."));
  });

  it("falls back to the reaction term when there is no narrative", () => {
    const draft = draftFromSlots(slots({ reaction: "rash on both hands" }));
    expect(draft.whatHappened).toEqual(answered("rash on both hands"));
  });
});

describe("form answers become chat answers", () => {
  it("carries the form's work into the chat", () => {
    const draft: ReportDraft = {
      ...EMPTY_DRAFT,
      whatHappened: answered("A rash on both arms."),
      medicineName: answered("Amoxil"),
      age: answered(61),
      sex: answered("female"),
      yourName: answered("J. Rivera"),
      yourEmail: answered("j.rivera@example.com"),
      currentState: answered("getting_better"),
    };
    const out = slotsFromDraft(draft);
    expect(out.narrative).toBe("A rash on both arms.");
    expect(out.drug).toBe("Amoxil");
    expect(out.age).toBe(61);
    expect(out.sex).toBe("female");
    expect(out.reporterName).toBe("J. Rivera");
    expect(out.reporterContact).toBe("j.rivera@example.com");
    expect(out.outcome).toBe("recovering");
  });

  /*
    THE failure this guards against. Five untouched yes/no questions must not
    become "none of those happened" — that is a fabricated negative on the
    field that decides whether a 15-day regulatory clock runs, attributed to a
    reporter who was never asked.
  */
  it("reports no seriousness answer when none of the five was answered", () => {
    expect(slotsFromDraft(EMPTY_DRAFT).seriousness).toBeNull();
  });

  it("reports the raised criteria once any of the five is answered", () => {
    const draft: ReportDraft = {
      ...EMPTY_DRAFT,
      wentToHospital: answered("yes"),
      died: answered("no"),
    };
    expect(slotsFromDraft(draft).seriousness).toEqual(["hospitalisation"]);
  });

  it("reports an empty list when every answered criterion was a no", () => {
    const draft: ReportDraft = { ...EMPTY_DRAFT, wentToHospital: answered("no") };
    expect(slotsFromDraft(draft).seriousness).toEqual([]);
  });

  it("maps a sex the chat cannot record to unknown rather than dropping it", () => {
    const draft: ReportDraft = { ...EMPTY_DRAFT, sex: answered("other") };
    expect(slotsFromDraft(draft).sex).toBe("unknown");
  });

  it("leaves the reaction term for the chat to ask, rather than inventing one", () => {
    const draft: ReportDraft = {
      ...EMPTY_DRAFT,
      whatHappened: answered("A long description of what happened."),
    };
    expect(slotsFromDraft(draft).reaction).toBeNull();
  });

  it("falls back to the phone number when no email was given", () => {
    const draft: ReportDraft = { ...EMPTY_DRAFT, yourPhone: answered("07700 900123") };
    expect(slotsFromDraft(draft).reporterContact).toBe("07700 900123");
  });
});

describe("a round trip loses nothing the form can hold", () => {
  it("survives chat to form and back", () => {
    const original = slots({
      narrative: "She came out in a rash on both arms.",
      drug: "Amoxil",
      age: 61,
      sex: "female",
      seriousness: ["hospitalisation"],
      reporterName: "J. Rivera",
      reporterContact: "j.rivera@example.com",
      dose: "500mg twice a day",
    });

    const back = slotsFromDraft(draftFromSlots(original));

    expect(back.narrative).toBe(original.narrative);
    expect(back.drug).toBe(original.drug);
    expect(back.age).toBe(original.age);
    expect(back.sex).toBe(original.sex);
    expect(back.seriousness).toEqual(original.seriousness);
    expect(back.reporterName).toBe(original.reporterName);
    expect(back.reporterContact).toBe(original.reporterContact);
    expect(back.dose).toBe(original.dose);
  });

  it("produces a draft that still parses as a ReportDraft", () => {
    const draft = draftFromSlots(
      slots({ drug: "Amoxil", age: 61, sex: "female", seriousness: [] }),
    );
    expect(() => {
      const parsed: ReportDraft = draft;
      return parsed;
    }).not.toThrow();
  });
});

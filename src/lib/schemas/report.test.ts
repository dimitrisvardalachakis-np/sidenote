import { describe, expect, it } from "vitest";
import {
  formatPartialDate,
  parsePartialDate,
  PartialDate,
  precisionOf,
} from "./partial-date";
import {
  answered,
  answerValue,
  isResolved,
  NOT_KNOWN,
  UNANSWERED,
} from "./answer";
import { cap, pronounsFor } from "./pronouns";
import {
  EMPTY_DRAFT,
  MISSING_MESSAGES,
  Report,
  ReportDraft,
  STEP_FIELDS,
  STEP_IDS,
  missingElements,
  stepProgress,
  trimDraft,
} from "./report";

describe("partial dates", () => {
  it("accepts a year on its own", () => {
    expect(parsePartialDate("2026")).toEqual({
      value: "2026",
      precision: "year",
    });
  });

  it("accepts a year and month", () => {
    expect(parsePartialDate("2026-03")).toEqual({
      value: "2026-03",
      precision: "month",
    });
  });

  it("accepts a full date", () => {
    expect(parsePartialDate("2026-03-14")).toEqual({
      value: "2026-03-14",
      precision: "day",
    });
  });

  it("round-trips 2026-03 back to the reader as March 2026", () => {
    const parsed = parsePartialDate("2026-03");
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    const throughSchema = PartialDate.parse(parsed);
    expect(formatPartialDate(throughSchema)).toBe("March 2026");
  });

  it("reads a year back as just the year, not January", () => {
    expect(formatPartialDate({ value: "2026", precision: "year" })).toBe("2026");
  });

  it("reads a full date back with the day", () => {
    expect(formatPartialDate({ value: "2026-03-14", precision: "day" })).toBe(
      "14 March 2026",
    );
  });

  it("refuses a day that does not exist", () => {
    expect(parsePartialDate("2026-02-30")).toBeNull();
    expect(PartialDate.safeParse({ value: "2026-02-30", precision: "day" }).success).toBe(false);
  });

  it("gets leap years right", () => {
    expect(parsePartialDate("2024-02-29")).not.toBeNull();
    expect(parsePartialDate("2026-02-29")).toBeNull();
  });

  it("refuses a month that does not exist", () => {
    expect(parsePartialDate("2026-13")).toBeNull();
    expect(parsePartialDate("2026-00")).toBeNull();
  });

  it("refuses text that is not a date at all", () => {
    expect(parsePartialDate("last March")).toBeNull();
    expect(parsePartialDate("14/03/2026")).toBeNull();
    expect(precisionOf("nonsense")).toBeNull();
  });

  it("will not let the stored precision disagree with the value", () => {
    // Claiming day precision on a month-only value would make the UI render
    // an invented day.
    expect(
      PartialDate.safeParse({ value: "2026-03", precision: "day" }).success,
    ).toBe(false);
  });
});

describe("three-state answers", () => {
  it("tells blank apart from I-don't-know", () => {
    expect(UNANSWERED.status).toBe("unanswered");
    expect(NOT_KNOWN.status).toBe("unknown");
    expect(UNANSWERED.status).not.toBe(NOT_KNOWN.status);
  });

  it("counts I-don't-know as dealt with, and blank as not", () => {
    expect(isResolved(NOT_KNOWN)).toBe(true);
    expect(isResolved(UNANSWERED)).toBe(false);
    expect(isResolved(answered("x"))).toBe(true);
  });

  it("yields a value only when one was given", () => {
    expect(answerValue(answered(42))).toBe(42);
    expect(answerValue(NOT_KNOWN)).toBeNull();
    expect(answerValue(UNANSWERED)).toBeNull();
  });

  it("survives the schema in all three states", () => {
    for (const value of [
      UNANSWERED,
      NOT_KNOWN,
      answered("Amoxil"),
    ]) {
      expect(
        ReportDraft.safeParse({ ...EMPTY_DRAFT, medicineName: value }).success,
      ).toBe(true);
    }
  });

  it("still rejects a bad value inside an answered field", () => {
    expect(
      ReportDraft.safeParse({
        ...EMPTY_DRAFT,
        yourEmail: answered("not-an-email"),
      }).success,
    ).toBe(false);
  });
});

describe("the four things a report needs", () => {
  it("names all four as missing on a blank form", () => {
    expect(missingElements(EMPTY_DRAFT)).toEqual([
      "who_it_happened_to",
      "who_you_are",
      "the_medicine",
      "what_happened",
    ]);
  });

  it("names exactly the two missing when only a medicine and an event are given", () => {
    const partial: ReportDraft = {
      ...EMPTY_DRAFT,
      medicineName: answered("Amoxil"),
      whatHappened: answered("A rash came up on both arms after two days."),
    };
    expect(missingElements(partial)).toEqual([
      "who_it_happened_to",
      "who_you_are",
    ]);
  });

  it("refuses to submit that report, and says why in plain words", () => {
    const partial: ReportDraft = {
      ...EMPTY_DRAFT,
      medicineName: answered("Amoxil"),
      whatHappened: answered("A rash came up on both arms after two days."),
    };
    const result = Report.safeParse(partial);
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain(MISSING_MESSAGES.who_it_happened_to);
    expect(messages).toContain(MISSING_MESSAGES.who_you_are);
  });

  it("uses no regulatory words in any of those messages", () => {
    const banned = [
      "adverse",
      "seriousness",
      "suspect product",
      "criteria",
      "valid case",
      "expedited",
      "—", // em-dash
    ];
    for (const message of Object.values(MISSING_MESSAGES)) {
      for (const word of banned) {
        expect(message.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("treats a self-report's own contact details as identifying the person", () => {
    const selfReport: ReportDraft = {
      ...EMPTY_DRAFT,
      about: answered("self"),
      medicineName: answered("Amoxil"),
      whatHappened: answered("A rash came up on both arms."),
      yourName: answered("Sam Patel"),
    };
    expect(missingElements(selfReport)).toEqual([]);
    expect(Report.safeParse(selfReport).success).toBe(true);
  });

  it("still needs a detail about someone else even when you identify yourself", () => {
    const aboutSomeoneElse: ReportDraft = {
      ...EMPTY_DRAFT,
      about: answered("someone_else"),
      medicineName: answered("Amoxil"),
      whatHappened: answered("A rash came up on both arms."),
      yourName: answered("Sam Patel"),
    };
    expect(missingElements(aboutSomeoneElse)).toEqual(["who_it_happened_to"]);
  });

  it("accepts an age alone as knowing who it happened to", () => {
    const withAge: ReportDraft = {
      ...EMPTY_DRAFT,
      about: answered("someone_else"),
      age: answered(72),
      medicineName: answered("Amoxil"),
      whatHappened: answered("A rash came up on both arms."),
      yourName: answered("Sam Patel"),
    };
    expect(missingElements(withAge)).toEqual([]);
  });

  it("does not count I-don't-know as an answer for the four", () => {
    const dunno: ReportDraft = {
      ...EMPTY_DRAFT,
      about: answered("someone_else"),
      age: NOT_KNOWN,
      sex: NOT_KNOWN,
      medicineName: answered("Amoxil"),
      whatHappened: answered("A rash."),
      yourName: answered("Sam Patel"),
    };
    expect(missingElements(dunno)).toContain("who_it_happened_to");
  });
});

describe("pronouns", () => {
  it("uses second person for a self report", () => {
    const p = pronounsFor("self");
    expect(`Did ${p.subject} go to hospital?`).toBe("Did you go to hospital?");
    expect(`What was ${p.possessive} dose?`).toBe("What was your dose?");
  });

  it("uses they for someone else", () => {
    const p = pronounsFor("someone_else");
    expect(`Did ${p.subject} go to hospital?`).toBe("Did they go to hospital?");
    expect(p.wereTaking).toBe("they were taking");
  });

  it("capitalises for the start of a sentence", () => {
    expect(cap(pronounsFor("self").subject)).toBe("You");
    expect(cap("")).toBe("");
  });
});

describe("steps", () => {
  it("has five", () => {
    expect(STEP_IDS).toHaveLength(5);
  });

  it("assigns every field to exactly one step", () => {
    const assigned = STEP_IDS.flatMap((id) => STEP_FIELDS[id]);
    const fields = Object.keys(ReportDraft.shape);
    expect([...assigned].sort()).toEqual([...fields].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("counts progress with I-don't-know as done", () => {
    const draft: ReportDraft = { ...EMPTY_DRAFT, age: NOT_KNOWN };
    expect(stepProgress(draft, "about")).toEqual({ resolved: 1, total: 3 });
    expect(stepProgress(EMPTY_DRAFT, "about")).toEqual({ resolved: 0, total: 3 });
  });
});

// ---------------------------------------------------------------------------
// The bug that ate people's spaces
// ---------------------------------------------------------------------------

describe("a draft holds what was typed, and only trims on the way out", () => {
  /*
    THE regression. `shortText` used to be `z.string().trim()`, which is a zod
    TRANSFORM — and the draft round-trips through `ReportDraft.safeParse` on
    every read, so a trailing space was stripped the instant it was typed and
    the next character landed against the previous word. Typing "Amoxil 500"
    produced "Amoxil500".
  */
  it("does not strip a trailing space while somebody is still typing", () => {
    const parsed = ReportDraft.safeParse({
      ...EMPTY_DRAFT,
      medicineName: { status: "answered", value: "Amoxil " },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    if (parsed.data.medicineName.status !== "answered") return;
    expect(parsed.data.medicineName.value).toBe("Amoxil ");
  });

  it("survives a round trip through the schema unchanged", () => {
    const typed = "co-codamol 30 mg ";
    let draft: ReportDraft = {
      ...EMPTY_DRAFT,
      medicineName: { status: "answered", value: typed },
    };
    // Three reads, as the draft store would do across three keystrokes.
    for (let i = 0; i < 3; i += 1) {
      const parsed = ReportDraft.safeParse(draft);
      if (!parsed.success) throw new Error("should parse");
      draft = parsed.data;
    }
    if (draft.medicineName.status !== "answered") throw new Error("answered");
    expect(draft.medicineName.value).toBe(typed);
  });

  it("still refuses whitespace-only, which is not an answer", () => {
    const parsed = ReportDraft.safeParse({
      ...EMPTY_DRAFT,
      medicineName: { status: "answered", value: "   " },
    });
    expect(parsed.success).toBe(false);
  });

  it("trims once at the submission boundary", () => {
    const trimmed = trimDraft({
      ...EMPTY_DRAFT,
      medicineName: { status: "answered", value: "  Amoxil 500  " },
      whatHappened: { status: "answered", value: "a rash\n" },
    });
    if (trimmed.medicineName.status !== "answered") throw new Error("answered");
    expect(trimmed.medicineName.value).toBe("Amoxil 500");
    if (trimmed.whatHappened.status !== "answered") throw new Error("answered");
    expect(trimmed.whatHappened.value).toBe("a rash");
  });

  it("turns a value that was only whitespace back into unanswered", () => {
    const trimmed = trimDraft({
      ...EMPTY_DRAFT,
      batchNumber: { status: "answered", value: "   " },
    });
    expect(trimmed.batchNumber.status).toBe("unanswered");
  });

  it("leaves non-string answers alone", () => {
    const trimmed = trimDraft({
      ...EMPTY_DRAFT,
      age: { status: "answered", value: 61 },
      wentToHospital: { status: "answered", value: "yes" },
    });
    expect(trimmed.age).toEqual({ status: "answered", value: 61 });
    expect(trimmed.wentToHospital).toEqual({ status: "answered", value: "yes" });
  });
});

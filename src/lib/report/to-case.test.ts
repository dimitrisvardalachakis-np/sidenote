import { describe, expect, it } from "vitest";
import { CaseReference, SERIOUSNESS_CRITERIA } from "@/lib/schemas";
import { answered, NOT_KNOWN } from "@/lib/schemas/answer";
import { EMPTY_DRAFT, type ReportDraft } from "@/lib/schemas/report";
import { reportToCase } from "./to-case";

const IDS = {
  caseId: "00000001-0000-4000-8000-000000000001",
  drugId: "00000002-0000-4000-8000-000000000002",
  reactionId: "00000003-0000-4000-8000-000000000003",
};

const build = (patch: Partial<ReportDraft>) =>
  reportToCase({
    draft: { ...EMPTY_DRAFT, ...patch },
    reference: CaseReference.parse("SN-2026-500001"),
    receivedAt: "2026-08-25",
    now: "2026-08-25T10:00:00Z",
    ids: IDS,
  });

const BASE: Partial<ReportDraft> = {
  about: answered("someone_else"),
  age: answered(72),
  medicineName: answered("Amoxil"),
  whatHappened: answered("A rash came up on both arms after two days."),
  yourName: answered("Sam Patel"),
};

const flagged = (record: ReturnType<typeof build>) =>
  SERIOUSNESS_CRITERIA.filter(
    (c) => record.reactions[0]?.seriousness[c] != null,
  );

describe("plain questions map onto the criteria", () => {
  it("raises nothing when nothing was said", () => {
    expect(flagged(build(BASE))).toEqual([]);
  });

  it("turns going to hospital into the hospitalisation criterion", () => {
    const record = build({ ...BASE, wentToHospital: answered("yes") });
    expect(flagged(record)).toEqual(["hospitalisation"]);
    expect(record.reactions[0]?.seriousness.hospitalisation?.kind).toBe("initial");
  });

  it("tells staying longer apart from going in", () => {
    const record = build({
      ...BASE,
      wentToHospital: answered("yes"),
      stayedLongerInHospital: answered("yes"),
    });
    expect(record.reactions[0]?.seriousness.hospitalisation?.kind).toBe("prolonged");
  });

  it("maps the other four questions to their criteria", () => {
    const record = build({
      ...BASE,
      lifeInDanger: answered("yes"),
      lastingProblem: answered("yes"),
      babyHarmed: answered("yes"),
      died: answered("yes"),
    });
    expect(flagged(record).sort()).toEqual(
      ["congenital_anomaly", "death", "life_threatening", "persistent_disability"].sort(),
    );
  });

  it("does NOT raise a flag for 'I don't know'", () => {
    // The difference between "no" and "I don't know" must not become a flag.
    // Guessing here would start a 15-day clock on the strength of a shrug.
    expect(flagged(build({ ...BASE, died: NOT_KNOWN }))).toEqual([]);
    expect(flagged(build({ ...BASE, lifeInDanger: NOT_KNOWN }))).toEqual([]);
  });

  it("does not raise a flag for a plain no", () => {
    expect(flagged(build({ ...BASE, died: answered("no") }))).toEqual([]);
  });

  it("records every flag as declared by the reporter, with no phrase", () => {
    const record = build({ ...BASE, lifeInDanger: answered("yes") });
    const flag = record.reactions[0]?.seriousness.life_threatening;
    expect(flag?.basis).toBe("declared");
    expect(flag?.trigger).toBeNull();
    expect(flag?.assertedBy).toBe("reporter");
    expect(flag?.confirmedByReviewer).toBe(false);
  });
});

describe("dates keep their precision all the way through", () => {
  it("carries a month-only onset into the case", () => {
    const record = build({
      ...BASE,
      startedOn: answered({ value: "2026-03", precision: "month" }),
    });
    expect(record.reactions[0]?.onset).toEqual({
      value: "2026-03",
      precision: "month",
    });
  });

  it("carries a year-only therapy start", () => {
    const record = build({
      ...BASE,
      startedMedicineOn: answered({ value: "2025", precision: "year" }),
    });
    expect(record.drugs[0]?.therapyStart).toEqual({
      value: "2025",
      precision: "year",
    });
  });
});

describe("stopping and restarting", () => {
  it("records nothing when the question was never reached", () => {
    const record = build(BASE);
    expect(record.drugs[0]?.dechallenge).toBeNull();
    expect(record.drugs[0]?.rechallenge).toBeNull();
  });

  it("reads 'it got better after stopping' as a positive dechallenge", () => {
    const record = build({ ...BASE, betterAfterStopping: answered("yes") });
    expect(record.drugs[0]?.dechallenge?.outcome).toBe("positive");
    expect(record.drugs[0]?.dechallenge?.confirmedByReviewer).toBe(false);
  });

  it("reads 'it happened again' as a positive rechallenge", () => {
    const record = build({
      ...BASE,
      cameBackAfterStartingAgain: answered("yes"),
    });
    expect(record.drugs[0]?.rechallenge?.outcome).toBe("positive");
  });
});

describe("what else survives the crossing", () => {
  it("keeps the reporter's own words as the narrative", () => {
    expect(build(BASE).narrative).toBe(
      "A rash came up on both arms after two days.",
    );
  });

  it("keeps 'another way to describe it' rather than flattening it", () => {
    expect(build({ ...BASE, sex: answered("other") }).patient?.sex).toBe("other");
  });

  it("leaves country null rather than guessing a code from a name", () => {
    const record = build({ ...BASE, country: answered("Ireland") });
    expect(record.reporter?.country).toBeNull();
  });

  it("assumes contact is allowed unless the reporter said otherwise", () => {
    expect(build(BASE).reporter?.contactPermitted).toBe(true);
    expect(
      build({ ...BASE, mayContactYou: answered("no") }).reporter
        ?.contactPermitted,
    ).toBe(false);
  });

  it("arrives as an unassessed public_form case", () => {
    const record = build(BASE);
    expect(record.origin).toBe("public_form");
    expect(record.status).toBe("received");
    expect(record.assignedTo).toBeNull();
  });
});

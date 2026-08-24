/**
 * The public form's rules, as executable claims.
 *
 * These matter more than most tests in the project because this schema is the
 * only thing standing between an anonymous internet endpoint and the case
 * queue. Every one of these runs against the same object the Server Action
 * validates.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_REPORT_VALUES,
  PublicReport,
  readReportFormValues,
  toFieldErrors,
  type ReportFormValues,
} from "./public-report";

/** A submission that satisfies all four minimum validity criteria. */
const VALID: ReportFormValues = {
  ...EMPTY_REPORT_VALUES,
  reactionTerm: "yellow skin and eyes",
  narrative:
    "Two days after starting the tablets the patient was admitted to hospital with severe jaundice.",
  medicineName: "Hepalex 20mg",
  patientInitials: "J.M.",
  patientAgeYears: "61",
  patientSex: "female",
  reporterName: "Dr A Weber",
  reporterEmail: "a.weber@example.org",
  reporterCountry: "DE",
  outcome: "recovering",
  relationship: "healthcare_professional",
};

const errorsFor = (values: ReportFormValues) => {
  const parsed = PublicReport.safeParse(values);
  return parsed.success ? {} : toFieldErrors(parsed.error);
};

describe("a complete report", () => {
  it("is accepted", () => {
    expect(PublicReport.safeParse(VALID).success).toBe(true);
  });

  it("turns untouched fields into null, not empty strings", () => {
    const parsed = PublicReport.parse(VALID);
    expect(parsed.medicineDose).toBeNull();
    expect(parsed.onset).toBeNull();
    expect(parsed.reporterPhone).toBeNull();
  });

  it("coerces the age from the string a form actually sends", () => {
    const parsed = PublicReport.parse(VALID);
    expect(parsed.patientAgeYears).toBe(61);
    expect(typeof parsed.patientAgeYears).toBe("number");
  });
});

describe("the four minimum validity criteria", () => {
  it("rejects a wholly empty submission on all four", () => {
    const errors = errorsFor(EMPTY_REPORT_VALUES);
    // event, suspect drug, patient, reporter — one message each.
    expect(Object.keys(errors).sort()).toEqual([
      "medicineName",
      "narrative",
      "patientInitials",
      "reactionTerm",
      "reporterEmail",
    ]);
  });

  it("needs a suspect drug", () => {
    expect(errorsFor({ ...VALID, medicineName: "" }).medicineName).toMatch(
      /name of the medicine/,
    );
  });

  it("needs an event, described", () => {
    expect(errorsFor({ ...VALID, narrative: "it was bad" }).narrative).toMatch(
      /a little more/,
    );
  });

  it("accepts a patient identified by age alone", () => {
    const ageOnly = {
      ...VALID,
      patientInitials: "",
      patientSex: "",
      patientAgeYears: "61",
    };
    expect(errorsFor(ageOnly).patientInitials).toBeUndefined();
  });

  it("rejects a patient who is not identifiable at all", () => {
    const nobody = {
      ...VALID,
      patientInitials: "",
      patientSex: "",
      patientAgeYears: "",
    };
    expect(errorsFor(nobody).patientInitials).toMatch(/person affected/);
  });

  it("does not let sex 'unknown' identify anybody", () => {
    const unknownOnly = {
      ...VALID,
      patientInitials: "",
      patientAgeYears: "",
      patientSex: "unknown",
    };
    expect(errorsFor(unknownOnly).patientInitials).toMatch(/person affected/);
  });

  it("accepts a reporter reachable by phone alone", () => {
    const phoneOnly = {
      ...VALID,
      reporterName: "",
      reporterEmail: "",
      reporterPhone: "+49 30 1234567",
    };
    expect(errorsFor(phoneOnly).reporterEmail).toBeUndefined();
  });

  it("rejects a reporter with a country but no way to reach them", () => {
    const unreachable = {
      ...VALID,
      reporterName: "",
      reporterEmail: "",
      reporterPhone: "",
      reporterCountry: "DE",
    };
    expect(errorsFor(unreachable).reporterEmail).toMatch(/follow up/);
  });
});

describe("cross-field checks", () => {
  it("catches a stop date before the start date", () => {
    const backwards = {
      ...VALID,
      startedOn: "2026-08-10",
      stoppedOn: "2026-08-01",
    };
    expect(errorsFor(backwards).stoppedOn).toMatch(/before the start date/);
  });

  it("allows a stop date equal to the start date", () => {
    const sameDay = {
      ...VALID,
      startedOn: "2026-08-10",
      stoppedOn: "2026-08-10",
    };
    expect(errorsFor(sameDay).stoppedOn).toBeUndefined();
  });

  it("catches 'they died' ticked without the matching outcome", () => {
    const contradiction = {
      ...VALID,
      seriousOutcomes: ["death"],
      outcome: "recovering",
    };
    expect(errorsFor(contradiction).outcome).toMatch(/They died/);
  });

  it("accepts death when the outcome agrees", () => {
    const consistent = {
      ...VALID,
      seriousOutcomes: ["death"],
      outcome: "died",
    };
    expect(errorsFor(consistent).outcome).toBeUndefined();
  });
});

describe("field formats", () => {
  it("rejects a malformed email", () => {
    expect(errorsFor({ ...VALID, reporterEmail: "not-an-email" }).reporterEmail)
      .toMatch(/email address/);
  });

  it("rejects a country that is not two letters", () => {
    expect(
      errorsFor({ ...VALID, reporterCountry: "GERMANY" }).reporterCountry,
    ).toMatch(/two-letter/);
  });

  it("rejects an implausible age", () => {
    expect(errorsFor({ ...VALID, patientAgeYears: "999" }).patientAgeYears)
      .toMatch(/check the age/);
  });

  it("rejects an age that is not a number", () => {
    expect(
      errorsFor({ ...VALID, patientAgeYears: "sixty one" }).patientAgeYears,
    ).toBeDefined();
  });

  it("shows only one message per field", () => {
    const errors = errorsFor({
      ...VALID,
      reporterEmail: "nope",
      reporterCountry: "XXX",
    });
    for (const message of Object.values(errors)) {
      expect(typeof message).toBe("string");
    }
  });
});

describe("readReportFormValues", () => {
  it("reads the same shape from FormData that the client validates", () => {
    const fd = new FormData();
    fd.set("medicineName", "Hepalex 20mg");
    fd.set("reactionTerm", "rash");
    fd.append("seriousOutcomes", "hospitalisation");
    fd.append("seriousOutcomes", "life_threatening");

    const values = readReportFormValues(fd);
    expect(values.medicineName).toBe("Hepalex 20mg");
    expect(values.seriousOutcomes).toEqual([
      "hospitalisation",
      "life_threatening",
    ]);
    // Absent fields read as "", never undefined.
    expect(values.reporterName).toBe("");
  });

  it("treats an absent checkbox as false, not missing", () => {
    expect(readReportFormValues(new FormData()).contactPermitted).toBe(false);
    const ticked = new FormData();
    ticked.set("contactPermitted", "on");
    expect(readReportFormValues(ticked).contactPermitted).toBe(true);
  });
});

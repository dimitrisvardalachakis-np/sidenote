/**
 * PublicReport — what a patient or carer submits at /report.
 *
 * This is its own entity, not a partial Case. The distinction matters: a
 * report records *what the reporter said*, and a Case records *what a
 * reviewer established*. A reporter ticking "they went to hospital" is a
 * declaration; a seriousness flag on a Case is a finding with a phrase behind
 * it. Collapsing the two would mean either weakening SeriousnessFlags so its
 * trigger span becomes optional, or asking a frightened member of the public
 * to supply character offsets. Neither is right, so they stay separate and
 * the reviewer bridges them during triage.
 *
 * CLAUDE.md non-negotiable #2: this exact schema is imported by the client
 * form and by the Server Action. There is no second definition.
 */
import { z } from "zod";
import { SERIOUSNESS_CRITERIA } from "./reaction";
import {
  blankToNull,
  blankToNullNumber,
  firstErrorPerField,
  formText,
} from "./form-helpers";


/**
 * How the reporter is connected to the person affected. Deliberately in plain
 * words rather than the regulator's vocabulary — this is mapped onto
 * ReporterQualification when the Case is created, so the reporter never has
 * to know what "other health professional" means.
 */
export const ReporterRelationship = z.enum([
  "self",
  "family_or_carer",
  "healthcare_professional",
  "other",
]);
export type ReporterRelationship = z.output<typeof ReporterRelationship>;

export const RELATIONSHIP_LABELS: Readonly<
  Record<ReporterRelationship, string>
> = {
  self: "It happened to me",
  family_or_carer: "I am a family member or carer",
  healthcare_professional: "I am a healthcare professional",
  other: "Something else",
};

/** Plain-language outcome, mapped to ReactionOutcome server-side. */
export const ReportedOutcome = z.enum([
  "recovered",
  "recovering",
  "not_recovered",
  "recovered_with_problems",
  "died",
  "unknown",
]);
export type ReportedOutcome = z.output<typeof ReportedOutcome>;

export const OUTCOME_LABELS: Readonly<Record<ReportedOutcome, string>> = {
  recovered: "They have fully recovered",
  recovering: "They are getting better",
  not_recovered: "They have not recovered",
  recovered_with_problems: "They recovered but have lasting problems",
  died: "They died",
  unknown: "I do not know",
};

/** Plain-language wording for the six criteria, for the public form only. */
export const SERIOUS_OUTCOME_LABELS: Readonly<Record<string, string>> = {
  death: "They died",
  life_threatening: "Their life was in danger",
  hospitalisation: "They went into hospital, or stayed longer than planned",
  persistent_disability: "They were left with a lasting disability",
  congenital_anomaly: "A baby was born with a problem",
  other_medically_important: "Something else serious happened",
};

export const YesNoUnknown = z.enum(["yes", "no", "unknown"]);
export type YesNoUnknown = z.output<typeof YesNoUnknown>;

// ---------------------------------------------------------------------------

export const PublicReport = z
  .object({
    // --- The person affected -------------------------------------------
    patientInitials: blankToNull(z.string().max(10)),
    patientAgeYears: blankToNullNumber(
      z
        .number({ error: "Please give an age in years, as a number." })
        .nonnegative("An age cannot be negative.")
        .max(130, "Please check the age."),
    ),
    patientSex: blankToNull(z.enum(["male", "female", "unknown"])),

    // --- The person reporting ------------------------------------------
    reporterName: blankToNull(z.string().max(120)),
    reporterEmail: blankToNull(
      z.email("That does not look like an email address."),
    ),
    reporterPhone: blankToNull(z.string().min(3).max(40)),
    reporterCountry: blankToNull(
      z.string().regex(/^[A-Za-z]{2}$/, "Use a two-letter country code."),
    ),
    relationship: ReporterRelationship,
    contactPermitted: z.boolean(),

    // --- The medicine ---------------------------------------------------
    medicineName: z
      .string()
      .trim()
      .min(2, "Please tell us the name of the medicine."),
    medicineDose: blankToNull(z.string().max(120)),
    medicineReason: blankToNull(z.string().max(200)),
    startedOn: blankToNull(z.iso.date("Use the date picker, or leave blank.")),
    stoppedOn: blankToNull(z.iso.date("Use the date picker, or leave blank.")),

    // --- What happened ---------------------------------------------------
    reactionTerm: z
      .string()
      .trim()
      .min(2, "Please say in a few words what went wrong."),
    narrative: z
      .string()
      .trim()
      .min(20, "Please tell us a little more — at least a sentence or two."),
    onset: blankToNull(z.iso.date("Use the date picker, or leave blank.")),
    outcome: ReportedOutcome,
    seriousOutcomes: z.array(z.enum(SERIOUSNESS_CRITERIA)),

    // --- Stopping and restarting ----------------------------------------
    stoppedTaking: YesNoUnknown,
    improvedAfterStopping: YesNoUnknown,
  })
  /**
   * The four minimum validity criteria, enforced here as cross-field rules
   * rather than as required fields, because "identifiable" is a property of
   * the whole answer and not of any one input.
   *
   * medicineName covers the suspect drug, and reactionTerm plus narrative
   * cover the event, so only the patient and reporter need a cross-check.
   */
  .superRefine((report, ctx) => {
    const patientIdentifiable =
      report.patientInitials !== null ||
      report.patientAgeYears !== null ||
      (report.patientSex !== null && report.patientSex !== "unknown");

    if (!patientIdentifiable) {
      ctx.addIssue({
        code: "custom",
        path: ["patientInitials"],
        message:
          "Tell us something about the person affected — their initials, their age, or whether they are male or female. We cannot use a report without at least one of these.",
      });
    }

    const reporterReachable =
      report.reporterName !== null ||
      report.reporterEmail !== null ||
      report.reporterPhone !== null;

    if (!reporterReachable) {
      ctx.addIssue({
        code: "custom",
        path: ["reporterEmail"],
        message:
          "Give us your name, an email address, or a phone number. We may need to ask you one more question, and a report we cannot follow up on cannot be used.",
      });
    }

    if (
      report.startedOn !== null &&
      report.stoppedOn !== null &&
      report.stoppedOn < report.startedOn
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["stoppedOn"],
        message: "The stop date is before the start date. Please check them.",
      });
    }

    // "They died" and an outcome of anything else is a contradiction we
    // should catch here rather than hand to a reviewer as a puzzle.
    if (report.seriousOutcomes.includes("death") && report.outcome !== "died") {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "You said the person died. Please also choose “They died” as the outcome, or untick that box.",
      });
    }
  });

export type PublicReport = z.output<typeof PublicReport>;

/**
 * The raw, unvalidated form state: strings all the way down, because that is
 * genuinely all an HTML form produces.
 *
 * Written out rather than taken from `z.input<typeof PublicReport>`, which
 * collapses to `unknown` on every preprocessed field and would hand the form
 * component no type at all. Keeping this explicit is what lets the form
 * repopulate itself after a server rejection without casting.
 */
export interface ReportFormValues {
  readonly patientInitials: string;
  readonly patientAgeYears: string;
  readonly patientSex: string;
  readonly reporterName: string;
  readonly reporterEmail: string;
  readonly reporterPhone: string;
  readonly reporterCountry: string;
  readonly relationship: string;
  readonly contactPermitted: boolean;
  readonly medicineName: string;
  readonly medicineDose: string;
  readonly medicineReason: string;
  readonly startedOn: string;
  readonly stoppedOn: string;
  readonly reactionTerm: string;
  readonly narrative: string;
  readonly onset: string;
  readonly outcome: string;
  readonly seriousOutcomes: readonly string[];
  readonly stoppedTaking: string;
  readonly improvedAfterStopping: string;
}

/**
 * Field-level errors, keyed by input name, ready to render inline.
 *
 * Only the first message per field is kept. Showing a reporter three
 * simultaneous complaints about one box is how a form gets abandoned.
 */
export type PublicReportFieldErrors = Partial<
  Record<keyof PublicReport | "form", string>
>;

export function toFieldErrors(error: z.ZodError): PublicReportFieldErrors {
  return firstErrorPerField<keyof PublicReport & string>(error);
}

/**
 * Read a FormData into the form-values shape.
 *
 * Lives here rather than in the Server Action because BOTH sides need it and
 * a "use server" module may only export async functions. Sharing it means the
 * client and the server cannot disagree about what the form said — which
 * would otherwise be a very quiet way for the two validations to diverge
 * while both appearing to pass.
 */
export function readReportFormValues(formData: FormData): ReportFormValues {
  return {
    patientInitials: formText(formData, "patientInitials"),
    patientAgeYears: formText(formData, "patientAgeYears"),
    patientSex: formText(formData, "patientSex"),
    reporterName: formText(formData, "reporterName"),
    reporterEmail: formText(formData, "reporterEmail"),
    reporterPhone: formText(formData, "reporterPhone"),
    reporterCountry: formText(formData, "reporterCountry"),
    relationship: formText(formData, "relationship"),
    // An unchecked box sends nothing at all, which is why this is a presence
    // test and not a comparison against "true".
    contactPermitted: formData.get("contactPermitted") !== null,
    medicineName: formText(formData, "medicineName"),
    medicineDose: formText(formData, "medicineDose"),
    medicineReason: formText(formData, "medicineReason"),
    startedOn: formText(formData, "startedOn"),
    stoppedOn: formText(formData, "stoppedOn"),
    reactionTerm: formText(formData, "reactionTerm"),
    narrative: formText(formData, "narrative"),
    onset: formText(formData, "onset"),
    outcome: formText(formData, "outcome"),
    seriousOutcomes: formData
      .getAll("seriousOutcomes")
      .filter((v): v is string => typeof v === "string"),
    stoppedTaking: formText(formData, "stoppedTaking"),
    improvedAfterStopping: formText(formData, "improvedAfterStopping"),
  };
}

/**
 * The blank form. Exported so the client and the server agree on what
 * "untouched" looks like, including which controls start selected.
 */
export const EMPTY_REPORT_VALUES: ReportFormValues = {
  patientInitials: "",
  patientAgeYears: "",
  patientSex: "",
  reporterName: "",
  reporterEmail: "",
  reporterPhone: "",
  reporterCountry: "",
  relationship: "self",
  contactPermitted: true,
  medicineName: "",
  medicineDose: "",
  medicineReason: "",
  startedOn: "",
  stoppedOn: "",
  reactionTerm: "",
  narrative: "",
  onset: "",
  outcome: "unknown",
  seriousOutcomes: [],
  stoppedTaking: "unknown",
  improvedAfterStopping: "unknown",
};

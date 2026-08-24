/**
 * Patient — one of the four minimum validity criteria.
 *
 * Not in the entity list the brief gave me, but "an identifiable patient" is
 * criterion one, and a criterion needs something to be true *of*. Splitting it
 * out keeps `caseValidity` honest: it can ask whether the patient is
 * identifiable rather than merely whether a field was filled in.
 *
 * Everything here is nullable because a public reporter will leave most of it
 * blank, and the case still has to be storable and displayable while it is
 * incomplete.
 */
import { z } from "zod";
import { IsoDate } from "./primitives";

/** ICH E2B sex codes, spelled out. */
export const PatientSex = z.enum(["male", "female", "unknown"]);
export type PatientSex = z.output<typeof PatientSex>;

/**
 * Used when an exact age is unknown but the band is reported. These bands are
 * the ones regulators expect; do not invent new ones.
 */
export const AgeGroup = z.enum([
  "neonate",
  "infant",
  "child",
  "adolescent",
  "adult",
  "elderly",
]);
export type AgeGroup = z.output<typeof AgeGroup>;

export const Patient = z.object({
  /** Free-text initials as reported, e.g. "J.M.". Never a full name. */
  initials: z.string().min(1).max(10).nullable(),
  ageYears: z.number().nonnegative().max(130).nullable(),
  ageGroup: AgeGroup.nullable(),
  sex: PatientSex.nullable(),
  dateOfBirth: IsoDate.nullable(),
  weightKg: z.number().positive().max(700).nullable(),
  /** Reporter's own record number for this patient, if they gave one. */
  localIdentifier: z.string().min(1).max(64).nullable(),
});
export type Patient = z.output<typeof Patient>;

/**
 * A patient is identifiable when at least one characteristic pins them down.
 * Presence of the object is not enough — a Patient with every field null is
 * exactly the "we received a form with nothing in it" case, and criterion one
 * is not met.
 *
 * `sex: "unknown"` deliberately does not count. It carries no identifying
 * information, and treating it as a hit would let an empty form pass.
 */
export function isIdentifiablePatient(patient: Patient | null): boolean {
  if (patient === null) return false;
  return (
    patient.initials !== null ||
    patient.ageYears !== null ||
    patient.ageGroup !== null ||
    patient.dateOfBirth !== null ||
    patient.localIdentifier !== null ||
    (patient.sex !== null && patient.sex !== "unknown")
  );
}

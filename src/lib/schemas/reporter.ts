/**
 * ReporterInfo — the second of the four minimum validity criteria.
 *
 * The reporter is the person who told us, which is not the same person as the
 * patient. A carer reporting on a relative is the common case, and the form
 * has to let them be different people.
 */
import { z } from "zod";

/**
 * Qualification drives weight in causality review: a physician's dechallenge
 * account is treated differently from a consumer's. It is also reported to the
 * regulator, so the vocabulary is fixed.
 */
export const ReporterQualification = z.enum([
  "physician",
  "pharmacist",
  "other_health_professional",
  "consumer_or_carer",
  "lawyer",
]);
export type ReporterQualification = z.output<typeof ReporterQualification>;

export const ReporterInfo = z.object({
  name: z.string().min(1).max(120).nullable(),
  organisation: z.string().min(1).max(160).nullable(),
  /** ISO 3166-1 alpha-2, uppercased. Where the report came from. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "Expected a two-letter country code")
    .nullable(),
  qualification: ReporterQualification.nullable(),
  email: z.email().nullable(),
  phone: z.string().min(3).max(40).nullable(),
  /**
   * A reporter may ask not to be contacted again. Recorded because it changes
   * what follow-up the reviewer is allowed to attempt.
   */
  contactPermitted: z.boolean(),
});
export type ReporterInfo = z.output<typeof ReporterInfo>;

/**
 * Identifiable means we could, in principle, go back to this person for
 * follow-up: a name, an organisation, or a way to reach them.
 *
 * Country and qualification alone are not enough. "A physician in Germany"
 * identifies nobody, and letting it satisfy criterion two would wave through
 * reports that can never be followed up.
 */
export function isIdentifiableReporter(reporter: ReporterInfo | null): boolean {
  if (reporter === null) return false;
  return (
    reporter.name !== null ||
    reporter.organisation !== null ||
    reporter.email !== null ||
    reporter.phone !== null
  );
}

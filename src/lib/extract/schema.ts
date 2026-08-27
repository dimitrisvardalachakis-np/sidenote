/**
 * What the model is allowed to pull out of a free-text report.
 *
 * The same discipline as the assessment reading, for the same reason. The
 * model fills fields; it does not decide anything about them. In particular
 * there is no `valid` field and no `serious` boolean: `caseValidity` decides
 * the four minimum criteria from the fields, and seriousness is a consequence
 * of which criteria were found, not an opinion the model gets to hold.
 *
 * The seriousness criteria are the one place a model genuinely beats the
 * regex it replaces. "She was kept in overnight" is a hospitalisation and no
 * pattern list gets there by accident; the existing keyword list catches it
 * only because someone happened to put "overnight" in it, while
 * `other_medically_important: /\b(serious|severe|urgent)\b/` fires on a
 * reporter writing "it was serious", which is a lay word and not a medical
 * judgement. So each criterion the model raises must come with the exact
 * phrase from the report that triggered it, verified in code — the same
 * verbatim rule the assessment uses, for the same reason.
 */
import { z } from "zod";
import { SERIOUSNESS_CRITERIA } from "@/lib/schemas";

/** The literal shape asked for. Permissive; coherence is checked in code. */
export const RawExtraction = z.object({
  suspectDrug: z.string().nullable(),
  reaction: z.string().nullable(),
  dose: z.string().nullable(),
  route: z.string().nullable(),
  patientAgeYears: z.number().nullable(),
  patientSex: z.string().nullable(),
  therapyStart: z.string().nullable(),
  therapyEnd: z.string().nullable(),
  reactionOnset: z.string().nullable(),
  outcome: z.string().nullable(),
  seriousness: z.array(
    z.object({
      criterion: z.string(),
      /** Copied character-for-character out of the report. */
      phrase: z.string(),
    }),
  ),
});
export type RawExtraction = z.output<typeof RawExtraction>;

/** A criterion the model raised, with the phrase that carried it. */
export const SeriousnessEvidence = z.object({
  criterion: z.enum(SERIOUSNESS_CRITERIA),
  phrase: z.string().min(1),
  /** Character offsets into the submitted text, so the UI can highlight it. */
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
});
export type SeriousnessEvidence = z.output<typeof SeriousnessEvidence>;

/**
 * The verified extraction.
 *
 * Every field is nullable and none is required, because a report that says
 * only "the tablets made me itch" is a real report and the shape has to hold
 * it. What is missing is `caseValidity`'s business, and the UI's.
 */
export const Extraction = z.object({
  suspectDrug: z.string().min(1).max(200).nullable(),
  reaction: z.string().min(1).max(400).nullable(),
  dose: z.string().min(1).max(120).nullable(),
  route: z
    .enum([
      "oral",
      "intravenous",
      "intramuscular",
      "subcutaneous",
      "topical",
      "inhalation",
      "other",
      "unknown",
    ])
    .nullable(),
  patientAgeYears: z.int().min(0).max(130).nullable(),
  patientSex: z.enum(["male", "female", "unknown"]).nullable(),
  therapyStart: z.string().nullable(),
  therapyEnd: z.string().nullable(),
  reactionOnset: z.string().nullable(),
  outcome: z
    .enum([
      "recovered",
      "recovering",
      "not_recovered",
      "recovered_with_sequelae",
      "fatal",
      "unknown",
    ])
    .nullable(),
  seriousness: z.array(SeriousnessEvidence),
  model: z.string().min(1),
  gatewayRequestId: z.string().min(1).nullable(),
  generatedAt: z.string().min(1),
});
export type Extraction = z.output<typeof Extraction>;

/**
 * What a reviewer tells us about a document they are uploading.
 *
 * Same rule as the public form: this schema is imported by the client panel
 * and by the Server Action, and genuinely runs on both.
 */
import { z } from "zod";
import { DocumentKind } from "./document";
import type { SourceType } from "./primitives";
import { blankToNull, firstErrorPerField, formText } from "./form-helpers";

export const DocumentUpload = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the document a title a reviewer will recognise.")
    .max(300),
  kind: DocumentKind,
  activeSubstance: z
    .string()
    .trim()
    .min(2, "Which active substance does this document govern?")
    .max(200),
  version: blankToNull(z.string().max(60)),
  effectiveDate: blankToNull(
    z.iso.date("Use the date picker, or leave this blank."),
  ),
});
export type DocumentUpload = z.output<typeof DocumentUpload>;

/**
 * The company/public split is derived, never asked.
 *
 * A reviewer choosing "CCDS" and then separately choosing "public" would be a
 * confidentiality incident one dropdown away, so the answer follows from the
 * document kind and the SafetyDocument schema refuses any other pairing.
 */
export function sourceTypeForKind(kind: DocumentKind): SourceType {
  return kind === "fda_label" ? "public" : "company";
}

export const DOCUMENT_KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  ccds: "Company Core Data Sheet (confidential)",
  investigators_brochure: "Investigator's Brochure (confidential)",
  fda_label: "FDA label (public)",
};

export interface UploadFormValues {
  readonly title: string;
  readonly kind: string;
  readonly activeSubstance: string;
  readonly version: string;
  readonly effectiveDate: string;
}

export const EMPTY_UPLOAD_VALUES: UploadFormValues = {
  title: "",
  kind: "ccds",
  activeSubstance: "",
  version: "",
  effectiveDate: "",
};

export function readUploadFormValues(formData: FormData): UploadFormValues {
  return {
    title: formText(formData, "title"),
    kind: formText(formData, "kind"),
    activeSubstance: formText(formData, "activeSubstance"),
    version: formText(formData, "version"),
    effectiveDate: formText(formData, "effectiveDate"),
  };
}

export type UploadFieldErrors = Partial<
  Record<(keyof DocumentUpload & string) | "form" | "file", string>
>;

export function toUploadFieldErrors(error: z.ZodError): UploadFieldErrors {
  return firstErrorPerField<keyof DocumentUpload & string>(error);
}

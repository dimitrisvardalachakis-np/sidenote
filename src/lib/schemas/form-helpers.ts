/**
 * Adapters between what HTML forms produce and what the domain schemas want.
 *
 * Every control on a form yields a string, and an untouched one yields "".
 * Treating "" as null rather than as an empty string is what lets the domain
 * schemas say `.nullable()` and mean it — and it is why a blank optional field
 * lands in storage as `null` instead of `""`, which is the difference between
 * "not provided" and "provided as nothing".
 */
import { z } from "zod";

/** Blank text becomes null; anything else is handed to `schema`. */
export function blankToNull<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    schema.nullable(),
  );
}

/**
 * As above, for a number arriving as text.
 *
 * Unparseable input is passed through unchanged rather than coerced to NaN,
 * so the inner schema reports "expected a number" instead of the form
 * silently accepting nonsense as zero.
 */
export function blankToNullNumber<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? v : parsed;
  }, schema.nullable());
}

/** FormData gives strings or nothing. Normalise once. */
export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Field-level errors keyed by input name, ready to render inline.
 *
 * Only the first message per field is kept. Showing three simultaneous
 * complaints about one box is how a form gets abandoned.
 */
export function firstErrorPerField<K extends string>(
  error: z.ZodError,
): Partial<Record<K | "form", string>> {
  const errors: Partial<Record<K | "form", string>> = {};
  for (const issue of error.issues) {
    const first = issue.path[0];
    const key = typeof first === "string" ? first : "form";
    if (!(key in errors)) {
      Object.assign(errors, { [key]: issue.message });
    }
  }
  return errors;
}

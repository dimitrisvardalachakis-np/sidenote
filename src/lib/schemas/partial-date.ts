/**
 * Dates people actually know.
 *
 * Someone reporting a side effect often remembers the month but not the day,
 * or only the year. A date input that demands all three forces them to invent
 * a day, and an invented day is worse than a missing one: it looks like a fact
 * and a reviewer will treat it as one when working out whether the reaction
 * started before or after the medicine did.
 *
 * So the precision travels with the value. "2026-03" means March, not the 1st
 * of March.
 */
import { z } from "zod";

export const DatePrecision = z.enum(["year", "month", "day"]);
export type DatePrecision = z.output<typeof DatePrecision>;

const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Precision implied by the text, or null when it is not a date we accept. */
export function precisionOf(text: string): DatePrecision | null {
  if (YEAR.test(text)) return "year";
  if (MONTH.test(text)) return "month";
  if (DAY.test(text)) return "day";
  return null;
}

function isRealDate(text: string): boolean {
  const day = DAY.exec(text);
  if (day !== null) {
    const [, y, m, d] = day;
    if (y === undefined || m === undefined || d === undefined) return false;
    const year = Number(y);
    const month = Number(m);
    const date = Number(d);
    if (month < 1 || month > 12) return false;
    // Round-tripping through Date catches the 30th of February without a
    // table of month lengths, and gets leap years right for free.
    const made = new Date(Date.UTC(year, month - 1, date));
    return (
      made.getUTCFullYear() === year &&
      made.getUTCMonth() === month - 1 &&
      made.getUTCDate() === date
    );
  }

  const month = MONTH.exec(text);
  if (month !== null) {
    const raw = month[2];
    if (raw === undefined) return false;
    const value = Number(raw);
    return value >= 1 && value <= 12;
  }

  return YEAR.test(text);
}

/**
 * A date and how precisely it is known.
 *
 * Both are stored, and a refinement holds them in agreement. Deriving
 * precision on read instead would work today and quietly break the first time
 * anything writes a value without going through here.
 */
export const PartialDate = z
  .object({
    /** Exactly as stored: "2026", "2026-03" or "2026-03-14". */
    value: z.string(),
    precision: DatePrecision,
  })
  .refine((d) => isRealDate(d.value) && precisionOf(d.value) === d.precision, {
    message: "That date is not one we recognise.",
    path: ["value"],
  });
export type PartialDate = z.output<typeof PartialDate>;

/** Build one from free text. Returns null when the text is not usable. */
export function parsePartialDate(text: string): PartialDate | null {
  const trimmed = text.trim();
  const precision = precisionOf(trimmed);
  if (precision === null || !isRealDate(trimmed)) return null;
  return { value: trimmed, precision };
}

export const MONTH_NAMES: readonly string[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * How the date reads back to the person who typed it.
 *
 * "2026-03" becomes "March 2026", not "1 March 2026" and not "2026-03". The
 * whole point of keeping the precision is that it is visible again here.
 */
export function formatPartialDate(date: PartialDate): string {
  const parts = date.value.split("-");
  const year = parts[0] ?? "";

  if (date.precision === "year") return year;

  const monthIndex = Number(parts[1] ?? "0") - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? "";
  if (date.precision === "month") return `${monthName} ${year}`;

  const day = Number(parts[2] ?? "0");
  return `${day} ${monthName} ${year}`;
}

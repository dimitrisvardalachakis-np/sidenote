/**
 * Every timestamp this application shows a reviewer, in the clinic's own time.
 *
 * Until this module existed, a timestamp was rendered by slicing the ISO
 * string — `iso.slice(11, 16)` for a time, `iso.slice(0, 16).replace("T", " ")`
 * for a date and time. That is UTC with the Z filed off. A case claimed at
 * 12:16 in Athens displayed 09:16, and the panel said "since" as though it
 * meant it.
 *
 * The same slice was also doing arithmetic. `new Date().toISOString()
 * .slice(0, 10)` was the civil date fed to `expeditedClock` on six screens,
 * and between 00:00 and 03:00 Athens time that string is YESTERDAY. Every
 * 15-day deadline and every "due today" label was a day out for three hours a
 * night — silently, and in the direction of reporting late.
 *
 * ONE TIMEZONE, HARD-CODED, AND DELIBERATELY SO. There is no user-facing
 * setting and there should not be: this is one safety team in one city, and a
 * per-reviewer timezone would mean two people reading different deadlines off
 * the same case. If that ever stops being true the constant below is the one
 * place to change, and it should become a property of the case rather than of
 * the viewer.
 *
 * WHAT THIS DOES NOT TOUCH is the clock arithmetic itself. `expeditedClock`
 * and `expeditedDeadline` in `schemas/case.ts` count whole days between
 * UTC-midnight instants and stay exactly as they are — day counting has to be
 * timezone-free to be reproducible in a test. What changes is only the civil
 * date handed to them, and the strings a human reads.
 *
 * Format is deliberately ISO-shaped — "2026-09-04 12:16" rather than "4 Sep
 * 2026, 12:16 pm". This is an instrument panel: the columns are tabular-nums,
 * they align, and they sort by eye. `hourCycle: "h23"` keeps 00:xx from
 * rendering as 24:xx, which `hour12: false` alone does not guarantee.
 */
import type { IsoDate } from "@/lib/schemas";

/** The clinic. See the note above before making this configurable. */
const ZONE = "Europe/Athens";

/*
  Built once at module load rather than per call. `Intl.DateTimeFormat` is the
  expensive part of formatting — it resolves locale data on construction — and
  the queue renders a timestamp per row.
*/
const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface Civil {
  readonly date: string;
  readonly time: string;
}

/**
 * The Athens wall-clock date and time of an instant.
 *
 * Assembled from `formatToParts` rather than from a locale's own ordering.
 * A locale string is a presentation decision the ICU data is allowed to
 * change between releases; the parts are named, and reading them by name is
 * what makes "2026-09-04" a promise rather than a coincidence.
 */
function civil(instant: Date): Civil {
  const parts = new Map(
    PARTS.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.get(type) ?? "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * Parse, or say we could not.
 *
 * Every caller is handed an `IsoDateTime` that has already been through zod,
 * so an unparseable value is a bug rather than a state. It still must not
 * throw: these run inside server components, and a formatting fault that 500s
 * the case screen would stop a reviewer claiming and ruling — exactly what
 * non-negotiable #8 forbids the AI path from doing, for the same reason. So
 * the raw string is returned unchanged, which is no worse than the slicing
 * this module replaced, and is visibly wrong rather than quietly wrong.
 */
function parse(iso: string): Date | null {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** "2026-09-04" — the Athens civil date of an instant. */
export function formatDate(iso: string): string {
  const instant = parse(iso);
  return instant === null ? iso : civil(instant).date;
}

/** "12:16" — the Athens wall-clock time of an instant. */
export function formatTime(iso: string): string {
  const instant = parse(iso);
  return instant === null ? iso : civil(instant).time;
}

/**
 * "2026-09-04 12:16" — both, and the default almost everywhere.
 *
 * A bare time is ambiguous the moment the thing it describes is more than a
 * day old, and the claim panel is the case in point: "You have this case since
 * 09:16" says nothing about which day, on a screen whose whole purpose is to
 * say since when.
 */
export function formatDateTime(iso: string): string {
  const instant = parse(iso);
  if (instant === null) return iso;
  const { date, time } = civil(instant);
  return `${date} ${time}`;
}

/**
 * Today, in Athens — the civil date every deadline is counted from.
 *
 * Takes the instant rather than reading the clock, for the reason
 * `expeditedClock` takes `today`: a queue that cannot be pinned to a date
 * cannot be tested, and the seeded fixtures resolve their offsets against
 * whatever this returns.
 */
export function todayInAthens(now: Date = new Date()): IsoDate {
  return civil(now).date as IsoDate;
}

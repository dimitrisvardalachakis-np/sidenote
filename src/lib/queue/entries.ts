import "server-only";
import { cache } from "react";
import { buildSeedCases } from "@/lib/fixtures/seed";
import { getCaseStore } from "@/lib/store/case-store";
import { getAssessmentStore } from "@/lib/store/assessment-store";
import type { Assessment, Case, IsoDate } from "@/lib/schemas";

/**
 * One row in the reviewer queue.
 *
 * `assessment` is nullable, and that nullability is the point. A case that has
 * just arrived through the intake chat has not been assessed yet — no model
 * has looked at it, no retrieval has run — so there is no listedness finding
 * and therefore no way to know whether the 15-day clock applies.
 *
 * The wrong move here would be to synthesise an empty assessment so the types
 * line up. That would render as "no result found", which is a FINDING, and a
 * reviewer would read it as "the documents do not mention this" when in truth
 * nobody has looked. Keeping it null forces every screen to distinguish
 * "assessed and found nothing" from "not assessed".
 */
export interface QueueEntry {
  readonly record: Case;
  readonly assessment: Assessment | null;
}

/**
 * The queue: seeded fixtures plus everything submitted through the app.
 *
 * Submitted cases come first within their sort band because they are the
 * newest thing a reviewer has not seen.
 *
 * Wrapped in React's `cache` so one render pass reads the store once. Three
 * callers now want the same list on the same request — `generateMetadata`,
 * the page, and the case screen's rail — and each of them hitting the disk
 * separately is work nobody asked for. The cache is per-request, so a case
 * assessed a moment ago is still fresh on the next render; it is a
 * deduplicator, not a store.
 */
export const loadQueue = cache(async function loadQueue(
  today: IsoDate,
): Promise<readonly QueueEntry[]> {
  const seeded: QueueEntry[] = buildSeedCases(today).map((s) => ({
    record: s.record,
    assessment: s.assessment,
  }));
  const seededIds = new Set(seeded.map((entry) => entry.record.id));

  /*
    The seeded cases ALSO exist as rows in D1, and must be listed once.

    They are anchors for a foreign key rather than a second copy of the truth.
    `assessments.case_id` references `cases(id)`, so until those twelve rows
    existed every attempt to store an assessment against a fixture — the one
    thing that puts a real model reading on the demo data — failed the
    constraint and took the case screen down with it. Nothing local could show
    that: with no D1 binding the assessment store falls through to the disk,
    which has no foreign keys.

    The fixture wins, and that direction is the point. `buildSeedCases` recomputes
    every date from `today`, so the fixture is what keeps the clocks honest as
    the days pass; the row is a stable id the database can point at. Dropping
    the row from this list rather than the fixture is what keeps the two from
    both appearing.
  */
  const submitted = (await (await getCaseStore()).list()).filter(
    (record) => !seededIds.has(record.id),
  );
  const store = await getAssessmentStore();

  /*
    A real assessment, where one has been run, wins over the seeded one.

    Both kinds of case can have one now: a reviewer can run the assessment on
    a submitted case, and can re-run it on a fixture — which is the only way
    to see a real model reading on the demo data. `null` still means nobody
    has looked, and still renders as "not assessed yet" rather than as a
    document saying nothing.
  */
  const submittedEntries: QueueEntry[] = await Promise.all(
    submitted.map(async (record) => ({
      record,
      assessment: await store.get(record.id),
    })),
  );

  const seededWithRuns: QueueEntry[] = await Promise.all(
    seeded.map(async (entry) => ({
      record: entry.record,
      assessment: (await store.get(entry.record.id)) ?? entry.assessment,
    })),
  );

  return [...submittedEntries, ...seededWithRuns];
});

export async function findQueueEntry(
  today: IsoDate,
  caseId: string,
): Promise<QueueEntry | null> {
  const entries = await loadQueue(today);
  return entries.find((entry) => entry.record.id === caseId) ?? null;
}

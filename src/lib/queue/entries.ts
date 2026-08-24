import "server-only";
import { buildSeedCases } from "@/lib/fixtures/seed";
import { getCaseStore } from "@/lib/store/case-store";
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
 */
export async function loadQueue(today: IsoDate): Promise<readonly QueueEntry[]> {
  const seeded: QueueEntry[] = buildSeedCases(today).map((s) => ({
    record: s.record,
    assessment: s.assessment,
  }));

  const submitted = await getCaseStore().list();
  const submittedEntries: QueueEntry[] = submitted.map((record) => ({
    record,
    assessment: null,
  }));

  return [...submittedEntries, ...seeded];
}

export async function findQueueEntry(
  today: IsoDate,
  caseId: string,
): Promise<QueueEntry | null> {
  const entries = await loadQueue(today);
  return entries.find((entry) => entry.record.id === caseId) ?? null;
}

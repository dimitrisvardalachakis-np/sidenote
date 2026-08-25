import "server-only";
import { z } from "zod";
import { buildSeedCases } from "@/lib/fixtures/seed";
import { getCaseStore } from "@/lib/store/case-store";
import { CACHE_KEY, TRIAGE_QUEUE_TTL_SECONDS, getCache } from "@/lib/cache/kv";
import { assessmentsForCases } from "@/lib/db/assessments";
import { Case } from "@/lib/schemas";
import type { Assessment, IsoDate } from "@/lib/schemas";

/**
 * Only the submitted half is cached, and it is cached WITHOUT `today` in the
 * key.
 *
 * The seeded fixtures are rebuilt against `today` on every call so the demo
 * queue always shows a believable spread of clock states. Caching them would
 * freeze that spread at whatever date the cache was warmed, and the queue
 * would quietly stop ageing. The submitted cases are real rows and do not
 * depend on the date at all, which is also what makes them the expensive half
 * — three D1 round trips — and therefore the half worth caching.
 */
const SubmittedCases = z.array(Case);

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

  const cache = await getCache();
  const store = await getCaseStore();
  const submitted = await cache.cached(
    CACHE_KEY.triageQueue,
    SubmittedCases,
    TRIAGE_QUEUE_TTL_SECONDS,
    () => store.list().then((cases) => [...cases]),
  );
  /**
   * Assessments are looked up, not assumed absent.
   *
   * Before Cluster E this was hard-coded to null, which was true — nothing
   * assessed anything. Now the pipeline writes them, and `null` has to mean
   * what it has always claimed to mean: nobody has looked yet. One query for
   * the whole page rather than one per case.
   */
  const assessments = await assessmentsForCases(
    submitted.map((record) => record.id),
  );
  const submittedEntries: QueueEntry[] = submitted.map((record) => ({
    record,
    assessment: assessments.get(record.id) ?? null,
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

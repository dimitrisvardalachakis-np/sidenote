import "server-only";
import { Assessment } from "@/lib/schemas";
import {
  assessmentForCase,
  assessmentsForCases,
  saveAssessment,
} from "@/lib/db/assessments";
import { getDb } from "@/lib/db/client";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  hasLocalDisk,
  nodeFs,
  nodePath,
} from "./backing";
import { CACHE_KEY, getCache } from "@/lib/cache/kv";
import { todayInAthens } from "@/lib/format/datetime";

/**
 * Assessments produced by an actual model run, as opposed to the seeded ones.
 *
 * Same seam as the other stores: an interface the app talks to, and an
 * implementation chosen by what is bound — D1 when it is there, the local disk
 * when there is one, per-isolate memory when there is neither.
 *
 * THIS FILE USED TO HAVE NO D1 BRANCH, AND SAID SO. The queue's
 * `saveAssessment` wrote D1 directly while everything a reviewer did came
 * here, and the note called unifying them "the honest remaining seam". Running
 * on workerd showed what the seam actually cost, which was more than a tidiness
 * argument:
 *
 *   - a reviewer's assessment landed in per-isolate memory and did not
 *     survive, announced only by an `ephemeral_write` audit line;
 *   - `deadline-sweep` reads assessments from D1, so it never saw one, `listed`
 *     was always null, and NO EXPEDITED CLOCK COULD EVER ARM — the 15-day
 *     obligation the whole app exists to enforce;
 *   - `label-diff` reads them too, and only enqueues re-assessment for a case
 *     that has one, so the queue had no reachable producer at all. Its only
 *     writer was the consumer, which nothing could start.
 *
 * One store over one table closes all three. Both halves go through
 * `lib/db/assessments.ts`, so there is one place that writes the row.
 *
 * Keyed by case id rather than assessment id, because the question the screen
 * asks is always "has this case been assessed?" — and a second run of the same
 * case replaces the first rather than accumulating, since the newer reading is
 * the one made against the current library.
 */
export interface AssessmentStore {
  put(record: Assessment): Promise<void>;
  get(caseId: string): Promise<Assessment | null>;
  /**
   * Several at once, keyed by case id, for the nightly sweeps.
   *
   * Here rather than as a loop at the call site because D1 can answer it in
   * one query and the others cannot, and because the sweeps used to call
   * `assessmentsForCases` DIRECTLY — reading D1 while every reviewer write
   * came through this interface. With no D1 bound that returned an empty map
   * whatever the reviewer had done, so `listed` was always null and no
   * expedited clock could arm under `next dev` at all. Going through the store
   * makes the sweep see exactly what the reviewer wrote, in every backing.
   */
  getMany(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, Assessment>>;
}

/** The loop the two non-D1 stores share. Small n: the queue, not the archive. */
async function collect(
  store: Pick<AssessmentStore, "get">,
  caseIds: readonly string[],
): Promise<ReadonlyMap<string, Assessment>> {
  const found = new Map<string, Assessment>();
  for (const caseId of caseIds) {
    const assessment = await store.get(caseId);
    if (assessment !== null) found.set(caseId, assessment);
  }
  return found;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class LocalFileAssessmentStore implements AssessmentStore {
  async put(record: Assessment): Promise<void> {
    const { mkdir, writeFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("assessments");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${record.caseId}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async get(caseId: string): Promise<Assessment | null> {
    if (!UUID.test(caseId)) return null;
    const { readFile } = await nodeFs();
    const { join } = await nodePath();
    try {
      const raw = await readFile(
        join(await dataPath("assessments"), `${caseId}.json`),
        "utf8",
      );
      // Parsed, not cast. A stored assessment is data arriving from outside
      // the process, and the schema is what keeps a hand-edited or
      // half-written file from reaching a reviewer as evidence.
      const result = Assessment.safeParse(JSON.parse(raw));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }
  getMany(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, Assessment>> {
    return collect(this, caseIds);
  }
}

/** Per-isolate assessments, for a Worker with no disk. */
class EphemeralAssessmentStore implements AssessmentStore {
  readonly #byCase = new Map<string, Assessment>();

  async put(record: Assessment): Promise<void> {
    announceEphemeralWrite("assessment_store", record.caseId);
    this.#byCase.set(record.caseId, record);
  }

  async get(caseId: string): Promise<Assessment | null> {
    return this.#byCase.get(caseId) ?? null;
  }
  getMany(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, Assessment>> {
    return collect(this, caseIds);
  }
}

/**
 * The real one, and deliberately a delegate rather than a second writer.
 *
 * `lib/db/assessments.ts` already had both halves of this — `saveAssessment`
 * for the queue and `assessmentForCase` for the sweeps — so wrapping them is
 * what makes the reviewer path and the pipeline path the same path. Writing
 * the row a second way here is exactly how the two would drift back apart.
 */
class D1AssessmentStore implements AssessmentStore {
  async put(record: Assessment): Promise<void> {
    await saveAssessment(record);
  }

  async get(caseId: string): Promise<Assessment | null> {
    return assessmentForCase(caseId);
  }

  /** One query, which is why this is on the interface at all. */
  async getMany(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, Assessment>> {
    return assessmentsForCases(caseIds);
  }
}

const localStore: AssessmentStore = new LocalFileAssessmentStore();

/**
 * Drops the cached queue whenever an assessment is written.
 *
 * A wrapper rather than a line in each of the three `put` implementations,
 * which is where the case store puts its equivalent — there is only one D1
 * class there, and there are three backings here, so the same rule written
 * three times is two chances to forget it.
 *
 * WHY THIS IS NEEDED AT ALL. `loadQueue` returns assessments as well as cases,
 * and the queue renders a ruling and the expedited clock that follows from it.
 * Only `case-store` invalidated, so a reviewer who recorded a ruling and went
 * back to the queue would have seen the case still unruled with its clock
 * still running, for as long as the TTL. A cache is allowed to be a minute
 * behind on when a case arrived; it is not allowed to be a minute behind on a
 * determination a human just made.
 *
 * The drop is awaited and its failure is the cache layer's problem, not this
 * one's: `KvCache.drop` swallows, because an assessment that stored correctly
 * must not be reported as failed because a cache key would not delete.
 */
class QueueInvalidating implements AssessmentStore {
  readonly #inner: AssessmentStore;
  constructor(inner: AssessmentStore) {
    this.#inner = inner;
  }

  async put(record: Assessment): Promise<void> {
    await this.#inner.put(record);
    const cache = await getCache();
    await cache.drop(
      CACHE_KEY.triageQueue(todayInAthens()),
    );
  }

  async get(caseId: string): Promise<Assessment | null> {
    return this.#inner.get(caseId);
  }

  async getMany(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, Assessment>> {
    return this.#inner.getMany(caseIds);
  }
}

/**
 * Ordered by how real the storage is, like `getCaseStore()`: D1 when it is
 * bound, the disk when there is one, and memory only when there is neither.
 */
export async function getAssessmentStore(): Promise<AssessmentStore> {
  return new QueueInvalidating(await resolveAssessmentStore());
}

async function resolveAssessmentStore(): Promise<AssessmentStore> {
  if ((await getDb()) !== null) return new D1AssessmentStore();

  // `hasLocalDisk()`, not "is it durable" — the two differ on exactly the
  // binding the branch above now catches, and asking the wrong one used to
  // reach for `node:fs` on a Worker.
  if (await hasLocalDisk()) return localStore;

  return ephemeralSingleton(
    "assessment_store",
    () => new EphemeralAssessmentStore(),
  );
}

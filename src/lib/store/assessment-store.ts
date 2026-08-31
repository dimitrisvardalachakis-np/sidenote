import "server-only";
import { Assessment } from "@/lib/schemas";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  hasLocalDisk,
  nodeFs,
  nodePath,
} from "./backing";

/**
 * Assessments produced by an actual model run, as opposed to the seeded ones.
 *
 * Same seam as the other stores: an interface the app talks to, and an
 * implementation chosen by what is bound — the local disk when there is one,
 * per-isolate memory when there is not. There is no D1 branch here yet and the
 * queue's `saveAssessment` writes D1 directly; unifying the two is the honest
 * remaining seam, marked rather than implied.
 *
 * Keyed by case id rather than assessment id, because the question the screen
 * asks is always "has this case been assessed?" — and a second run of the same
 * case replaces the first rather than accumulating, since the newer reading is
 * the one made against the current library.
 */
export interface AssessmentStore {
  put(record: Assessment): Promise<void>;
  get(caseId: string): Promise<Assessment | null>;
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
}

const localStore: AssessmentStore = new LocalFileAssessmentStore();

export async function getAssessmentStore(): Promise<AssessmentStore> {
  // `hasLocalDisk()`, not "is it durable". This store has no D1 branch, so on
  // a Worker with D1 bound there is nowhere durable to put an assessment and
  // no disk either — per-isolate memory is the honest answer, and it announces
  // itself. Asking the durability question here reached for `node:fs` instead.
  if (await hasLocalDisk()) return localStore;
  return ephemeralSingleton(
    "assessment_store",
    () => new EphemeralAssessmentStore(),
  );
}

import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Assessment } from "@/lib/schemas";

/**
 * Assessments produced by an actual model run, as opposed to the seeded ones.
 *
 * Same seam as the other stores: an interface the app talks to, a local-file
 * implementation for this session, one line for Cluster E to change to D1.
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

const DIR = join(process.cwd(), ".data", "assessments");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class LocalFileAssessmentStore implements AssessmentStore {
  async put(record: Assessment): Promise<void> {
    await mkdir(DIR, { recursive: true });
    await writeFile(
      join(DIR, `${record.caseId}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async get(caseId: string): Promise<Assessment | null> {
    if (!UUID.test(caseId)) return null;
    try {
      const raw = await readFile(join(DIR, `${caseId}.json`), "utf8");
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

let store: AssessmentStore | null = null;

export function getAssessmentStore(): AssessmentStore {
  store ??= new LocalFileAssessmentStore();
  return store;
}

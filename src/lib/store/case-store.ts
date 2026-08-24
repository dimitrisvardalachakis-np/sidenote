import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Case, CaseReference } from "@/lib/schemas";

/**
 * Cases submitted through the app, as opposed to the seeded fixtures.
 *
 * Same seam as the other stores: an interface the app talks to, a local-file
 * implementation for this session, one line for Cluster D to change to D1.
 *
 * The queue merges these with the fixtures rather than replacing them, so a
 * reviewer sees a realistic backlog AND anything just submitted. Submitted
 * cases sort to the top by receipt date because they are, genuinely, the
 * newest thing in the queue.
 */
export interface CaseStore {
  put(record: Case): Promise<void>;
  list(): Promise<readonly Case[]>;
  get(caseId: string): Promise<Case | null>;
  /** Next free public reference. Same known concurrency flaw as ReportStore. */
  nextReference(year: number): Promise<CaseReference>;
}

const CASES_DIR = join(process.cwd(), ".data", "cases");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Submitted cases live in their own numbering band so a reference can never
 * collide with a seeded fixture (which occupy 000101-000112).
 */
const SUBMITTED_BASE = 500_000;

class LocalFileCaseStore implements CaseStore {
  async put(record: Case): Promise<void> {
    await mkdir(CASES_DIR, { recursive: true });
    await writeFile(
      join(CASES_DIR, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async get(caseId: string): Promise<Case | null> {
    if (!UUID.test(caseId)) return null;
    try {
      const raw = await readFile(join(CASES_DIR, `${caseId}.json`), "utf8");
      return Case.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list(): Promise<readonly Case[]> {
    const names = await readdir(CASES_DIR).catch(() => []);
    const cases: Case[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(join(CASES_DIR, name), "utf8").catch(() => null);
      if (raw === null) continue;
      // Parsed, not cast: a stored file that no longer satisfies the schema is
      // skipped loudly-ish rather than rendered as a broken case.
      const parsed = Case.safeParse(JSON.parse(raw));
      if (parsed.success) cases.push(parsed.data);
    }
    return cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async nextReference(year: number): Promise<CaseReference> {
    const names = await readdir(CASES_DIR).catch(() => []);
    const count = names.filter((n) => n.endsWith(".json")).length;
    return CaseReference.parse(
      `SN-${year}-${String(SUBMITTED_BASE + count + 1).padStart(6, "0")}`,
    );
  }
}

const store: CaseStore = new LocalFileCaseStore();

/** The one line Cluster D changes. */
export function getCaseStore(): CaseStore {
  return store;
}

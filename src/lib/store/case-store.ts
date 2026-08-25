import "server-only";
import { Case, CaseReference } from "@/lib/schemas";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  nodeFs,
  nodePath,
  storageBacking,
} from "./backing";

/**
 * Cases submitted through the app, as opposed to the seeded fixtures.
 *
 * Same seam as the other stores: an interface the app talks to, two
 * implementations chosen by runtime, one line for Cluster D to change to D1.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Submitted cases live in their own numbering band so a reference can never
 * collide with a seeded fixture (which occupy 000101-000112).
 */
const SUBMITTED_BASE = 500_000;

function referenceFor(year: number, count: number): CaseReference {
  return CaseReference.parse(
    `SN-${year}-${String(SUBMITTED_BASE + count + 1).padStart(6, "0")}`,
  );
}

class LocalFileCaseStore implements CaseStore {
  async put(record: Case): Promise<void> {
    const { mkdir, writeFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("cases");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async get(caseId: string): Promise<Case | null> {
    if (!UUID.test(caseId)) return null;
    const { readFile } = await nodeFs();
    const { join } = await nodePath();
    try {
      const raw = await readFile(
        join(await dataPath("cases"), `${caseId}.json`),
        "utf8",
      );
      return Case.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list(): Promise<readonly Case[]> {
    const { readFile, readdir } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("cases");
    const names = await readdir(dir).catch(() => []);
    const cases: Case[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(join(dir, name), "utf8").catch(() => null);
      if (raw === null) continue;
      // Parsed, not cast: a stored file that no longer satisfies the schema is
      // skipped loudly-ish rather than rendered as a broken case.
      const parsed = Case.safeParse(JSON.parse(raw));
      if (parsed.success) cases.push(parsed.data);
    }
    return cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async nextReference(year: number): Promise<CaseReference> {
    const { readdir } = await nodeFs();
    const names = await readdir(await dataPath("cases")).catch(() => []);
    return referenceFor(year, names.filter((n) => n.endsWith(".json")).length);
  }
}

/**
 * Workers, until Cluster D binds D1.
 *
 * A Map on the isolate. It works for the length of one isolate's life and no
 * longer, which for a submitted safety report is a real hazard rather than a
 * cosmetic one — see backing.ts. Every write says so in the audit log.
 */
class EphemeralCaseStore implements CaseStore {
  readonly #cases = new Map<string, Case>();

  async put(record: Case): Promise<void> {
    this.#cases.set(record.id, record);
    announceEphemeralWrite("case_store", record.reference);
  }

  async get(caseId: string): Promise<Case | null> {
    if (!UUID.test(caseId)) return null;
    return this.#cases.get(caseId) ?? null;
  }

  async list(): Promise<readonly Case[]> {
    return [...this.#cases.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async nextReference(year: number): Promise<CaseReference> {
    return referenceFor(year, this.#cases.size);
  }
}

const localStore: CaseStore = new LocalFileCaseStore();

/** The one line Cluster D changes. */
export function getCaseStore(): CaseStore {
  if (storageBacking() !== "ephemeral") return localStore;
  // Anchored to the isolate rather than to this module: Next instantiates the
  // module once per bundle, so a plain `const` gives the queue page and the
  // API route separate Maps. See backing.ts.
  return ephemeralSingleton("case_store", () => new EphemeralCaseStore());
}

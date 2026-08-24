import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CaseReference, type IsoDateTime } from "@/lib/schemas";
import type { PublicReport } from "@/lib/schemas/public-report";

/**
 * Where submitted reports go.
 *
 * The interface is the point. Cluster A has no database, so this writes JSON
 * files under .data/reports — but every caller talks to `ReportStore`, so
 * Cluster D swaps in D1 by writing one new implementation and changing one
 * line in `getReportStore()`. No page, no action and no component knows which
 * one it is talking to. Same shape as the DocumentStore step 7 asks for.
 */

export interface StoredReport {
  readonly reference: CaseReference;
  readonly receivedAt: IsoDateTime;
  readonly report: PublicReport;
}

export interface ReportStore {
  /** Persists a report and returns it with the reference it was given. */
  put(report: PublicReport): Promise<StoredReport>;
  get(reference: string): Promise<StoredReport | null>;
  list(): Promise<readonly StoredReport[]>;
}

const DATA_DIR = join(process.cwd(), ".data", "reports");

function referenceFor(year: number, sequence: number): CaseReference {
  return CaseReference.parse(
    `SN-${year}-${String(sequence).padStart(6, "0")}`,
  );
}

class LocalFileReportStore implements ReportStore {
  async put(report: PublicReport): Promise<StoredReport> {
    await mkdir(DATA_DIR, { recursive: true });

    const year = new Date().getUTCFullYear();
    const existing = await readdir(DATA_DIR).catch(() => []);
    // Counting files is good enough for a local demo and wrong under any
    // concurrency: two simultaneous submissions can read the same count and
    // mint the same reference. Cluster D fixes this properly with a D1
    // sequence or a Durable Object, which is exactly the kind of thing a
    // Durable Object is for. Naming it here so it is not discovered later.
    const sequence =
      existing.filter((name) => name.endsWith(".json")).length + 1;

    const stored: StoredReport = {
      reference: referenceFor(year, sequence),
      receivedAt: new Date().toISOString(),
      report,
    };

    await writeFile(
      join(DATA_DIR, `${stored.reference}.json`),
      JSON.stringify(stored, null, 2),
      "utf8",
    );
    return stored;
  }

  async get(reference: string): Promise<StoredReport | null> {
    const parsed = CaseReference.safeParse(reference);
    // Refusing a malformed reference before touching the filesystem is what
    // stops "../../etc/passwd" being a path. The regex on CaseReference is
    // doing security work here, not just tidiness.
    if (!parsed.success) return null;
    try {
      const raw = await readFile(join(DATA_DIR, `${parsed.data}.json`), "utf8");
      return JSON.parse(raw) as StoredReport;
    } catch {
      return null;
    }
  }

  async list(): Promise<readonly StoredReport[]> {
    const names = await readdir(DATA_DIR).catch(() => []);
    const reports: StoredReport[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(join(DATA_DIR, name), "utf8").catch(() => null);
      if (raw !== null) reports.push(JSON.parse(raw) as StoredReport);
    }
    return reports;
  }
}

const store: ReportStore = new LocalFileReportStore();

/** The one line Cluster D changes. */
export function getReportStore(): ReportStore {
  return store;
}

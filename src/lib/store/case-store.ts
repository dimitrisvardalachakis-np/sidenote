import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { Case, CaseReference } from "@/lib/schemas";
import { getCaseCoordination } from "@/lib/coordinator";
import { CACHE_KEY, getCache } from "@/lib/cache/kv";
import { getDb, schema, type Db } from "@/lib/db/client";
import { asBatch, caseToRows, rowsToCase } from "@/lib/db/mappers";
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
 * Same seam as the other stores: an interface the app talks to, and three
 * implementations chosen by what is bound — D1 when there is a database, the
 * local disk when there is one, memory only when there is neither.
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

/**
 * D1, via Drizzle. The real one.
 */
class D1CaseStore implements CaseStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Upsert the case and REPLACE its children.
   *
   * Delete-then-insert rather than a per-row diff. A Case arrives from the
   * caller as a complete value — it is not a patch — so the drugs and
   * reactions in hand are the whole truth about this case, and reconciling
   * them row by row would be a lot of code whose only observable difference is
   * which of two identical states the table ends in.
   *
   * One batch, so it is one transaction. Half a case — the new narrative with
   * the old reactions — is a case whose seriousness flags point at character
   * offsets in text that no longer exists, and every highlight on the screen
   * would be quoting the wrong words.
   */
  async put(record: Case): Promise<void> {
    const { caseRow, drugRows, reactionRows } = caseToRows(record);

    await this.#db.batch(
      asBatch([
        this.#db
          .insert(schema.cases)
          .values(caseRow)
          .onConflictDoUpdate({ target: schema.cases.id, set: caseRow }),
        this.#db.delete(schema.drugs).where(eq(schema.drugs.caseId, record.id)),
        this.#db
          .delete(schema.reactions)
          .where(eq(schema.reactions.caseId, record.id)),
        ...drugRows.map((row) => this.#db.insert(schema.drugs).values(row)),
        ...reactionRows.map((row) =>
          this.#db.insert(schema.reactions).values(row),
        ),
      ]),
    );

    // Invalidated HERE, in the only place that knows a case was written.
    //
    // A store reaching into the cache layer looks like a layering violation
    // and is the opposite: the alternative is every caller remembering to drop
    // the key, and there are already three of them (the form, the JSON route,
    // the intake chat). The first one anybody forgets produces a queue that is
    // missing a report somebody was just told had been filed — with a
    // reference number to quote for it.
    const cache = await getCache();
    await cache.drop(CACHE_KEY.triageQueue);
  }

  async get(caseId: string): Promise<Case | null> {
    if (!UUID.test(caseId)) return null;

    const [caseRow] = await this.#db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.id, caseId))
      .limit(1);
    if (caseRow === undefined) return null;

    const [drugRows, reactionRows] = await Promise.all([
      this.#db
        .select()
        .from(schema.drugs)
        .where(eq(schema.drugs.caseId, caseId)),
      this.#db
        .select()
        .from(schema.reactions)
        .where(eq(schema.reactions.caseId, caseId)),
    ]);

    return rowsToCase(caseRow, drugRows, reactionRows);
  }

  /**
   * Three queries, not one per case.
   *
   * The obvious implementation — select the cases, then loop and fetch each
   * one's children — is N+1, and on D1 every one of those N is a round trip
   * that the queue page waits for. Fetching all children for the page of cases
   * at once and grouping them in memory is three round trips whatever N is.
   */
  async list(): Promise<readonly Case[]> {
    const caseRows = await this.#db
      .select()
      .from(schema.cases)
      .orderBy(desc(schema.cases.createdAt));
    if (caseRows.length === 0) return [];

    const ids = caseRows.map((row) => row.id);
    const [drugRows, reactionRows] = await Promise.all([
      this.#db
        .select()
        .from(schema.drugs)
        .where(inArray(schema.drugs.caseId, ids)),
      this.#db
        .select()
        .from(schema.reactions)
        .where(inArray(schema.reactions.caseId, ids)),
    ]);

    const drugsByCase = groupBy(drugRows, (row) => row.caseId);
    const reactionsByCase = groupBy(reactionRows, (row) => row.caseId);

    const cases: Case[] = [];
    for (const row of caseRows) {
      try {
        cases.push(
          rowsToCase(
            row,
            drugsByCase.get(row.id) ?? [],
            reactionsByCase.get(row.id) ?? [],
          ),
        );
      } catch {
        // One unparseable row must not empty the queue. Same policy as the
        // local store: skip it rather than render a broken case, because a
        // half-rendered case is a clinical claim nobody made.
        continue;
      }
    }
    return cases;
  }

  /**
   * Delegates to the Durable Object.
   *
   * The count here is only a SEED, used the first time the minter runs against
   * an existing database so the series does not restart at 1 and collide with
   * every case already filed. After that the minter's own counter is the
   * authority and this number is ignored — which is the whole point, because
   * counting is exactly the operation that races.
   */
  async nextReference(year: number): Promise<CaseReference> {
    const rows = await this.#db.select({ id: schema.cases.id }).from(schema.cases);
    const coordination = await getCaseCoordination();
    return CaseReference.parse(
      await coordination.mintReference(year, rows.length),
    );
  }
}

function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket === undefined) grouped.set(key(row), [row]);
    else bucket.push(row);
  }
  return grouped;
}

const localStore: CaseStore = new LocalFileCaseStore();

/**
 * The one line Cluster D changed — into three.
 *
 * Ordered by how real the storage is: D1 when it is bound, the disk when there
 * is one, and memory only when there is neither.
 */
export async function getCaseStore(): Promise<CaseStore> {
  const db = await getDb();
  if (db !== null) return new D1CaseStore(db);

  if ((await storageBacking()) !== "ephemeral") return localStore;

  // Anchored to the isolate rather than to this module: Next instantiates the
  // module once per bundle, so a plain `const` gives the queue page and the
  // API route separate Maps. See backing.ts.
  return ephemeralSingleton("case_store", () => new EphemeralCaseStore());
}

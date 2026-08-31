import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import type { DocumentChunk, SafetyDocument } from "@/lib/schemas";
import { getDb, schema, type Db } from "@/lib/db/client";
import {
  asBatch,
  chunkToRow,
  documentToRow,
  rowToChunk,
  rowToDocument,
} from "@/lib/db/mappers";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  hasLocalDisk,
  nodeFs,
  nodePath,
} from "./backing";

/**
 * The library index: document records and their chunks.
 *
 * Separate from DocumentStore on purpose. That one is R2 — opaque bytes keyed
 * by a string. This one is D1: rows you query. CLAUDE.md keeps them apart in
 * the target architecture, and collapsing them here would hide the fact that
 * Cluster D has two different bindings to wire up, not one.
 *
 * Chunk text is deliberately stored here alongside the document, mirroring
 * step 7 of the ingestion pipeline in CLAUDE.md: "Chunk text and metadata
 * mirrored into D1 so a citation can be rendered without a second vector
 * call, and so lexical search works."
 *
 * That mirroring is now load-bearing in a second way. `dense.ts` hydrates
 * every vector match from these chunks and drops any match this library does
 * not confirm, so a stale or leaked vector cannot become a citation. The
 * vector index contributes an id and a rank; the text always comes from here.
 */

export interface LibraryEntry {
  readonly document: SafetyDocument;
  readonly chunks: readonly DocumentChunk[];
}

export interface DocumentLibrary {
  save(entry: LibraryEntry): Promise<void>;
  get(documentId: string): Promise<LibraryEntry | null>;
  /** Records only. The chunks of every document would be a lot of rows. */
  list(): Promise<readonly SafetyDocument[]>;
}

/** Document ids are uuids; anything else never becomes a filename. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(documentId: string): void {
  if (!UUID.test(documentId)) {
    throw new Error(`Refusing a document id that is not a uuid: ${documentId}`);
  }
}

class LocalFileDocumentLibrary implements DocumentLibrary {
  async save(entry: LibraryEntry): Promise<void> {
    assertUuid(entry.document.id);
    const { mkdir, writeFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("library");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${entry.document.id}.json`),
      JSON.stringify(entry, null, 2),
      "utf8",
    );
  }

  async get(documentId: string): Promise<LibraryEntry | null> {
    if (!UUID.test(documentId)) return null;
    const { readFile } = await nodeFs();
    const { join } = await nodePath();
    try {
      const raw = await readFile(
        join(await dataPath("library"), `${documentId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as LibraryEntry;
    } catch {
      return null;
    }
  }

  async list(): Promise<readonly SafetyDocument[]> {
    const { readFile, readdir } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("library");
    const names = await readdir(dir).catch(() => []);
    const documents: SafetyDocument[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(join(dir, name), "utf8").catch(() => null);
      if (raw === null) continue;
      const entry = JSON.parse(raw) as LibraryEntry;
      documents.push(entry.document);
    }
    // Newest first: the reviewer who just uploaded something looks at the top.
    return documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
}

/**
 * Workers, until Cluster D binds D1.
 *
 * Less alarming than the case store's equivalent — a lost upload is a document
 * a reviewer still has on disk and can upload again, whereas a lost report is
 * gone. It is still announced, because "the library emptied itself overnight"
 * should be explained by a log line rather than investigated from scratch.
 */
class EphemeralDocumentLibrary implements DocumentLibrary {
  readonly #entries = new Map<string, LibraryEntry>();

  async save(entry: LibraryEntry): Promise<void> {
    assertUuid(entry.document.id);
    this.#entries.set(entry.document.id, entry);
    announceEphemeralWrite("document_library", entry.document.id);
  }

  async get(documentId: string): Promise<LibraryEntry | null> {
    if (!UUID.test(documentId)) return null;
    return this.#entries.get(documentId) ?? null;
  }

  async list(): Promise<readonly SafetyDocument[]> {
    return [...this.#entries.values()]
      .map((entry) => entry.document)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
}

/**
 * D1, via Drizzle. The real one.
 *
 * This is the half of pipeline step 7 that CLAUDE.md spells out: "Chunk text
 * and metadata mirrored into D1 so a citation can be rendered without a second
 * vector call, and so lexical search works." Writing a chunk row here is also
 * what populates the FTS5 index — the triggers in migration 0001 do it, so
 * there is no way to save a chunk and forget to index it.
 */
class D1DocumentLibrary implements DocumentLibrary {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async save(entry: LibraryEntry): Promise<void> {
    assertUuid(entry.document.id);
    const documentRow = documentToRow(entry.document);

    await this.#db.batch(
      asBatch([
        this.#db
          .insert(schema.documents)
          .values(documentRow)
          .onConflictDoUpdate({
            target: schema.documents.id,
            set: documentRow,
          }),
        // Re-ingesting a document replaces its chunks rather than adding a
        // second set. Chunk ids are `${documentId}#${ordinal}` and therefore
        // deterministic, so without this a re-run that produced FEWER chunks
        // would leave the surplus behind — orphans that still answer searches
        // and still render as citations into text that has been re-cut.
        this.#db
          .delete(schema.chunks)
          .where(eq(schema.chunks.documentId, entry.document.id)),
        ...entry.chunks.map((chunk) =>
          this.#db.insert(schema.chunks).values(chunkToRow(chunk)),
        ),
      ]),
    );
  }

  async get(documentId: string): Promise<LibraryEntry | null> {
    if (!UUID.test(documentId)) return null;

    const [row] = await this.#db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1);
    if (row === undefined) return null;

    const chunkRows = await this.#db
      .select()
      .from(schema.chunks)
      .where(eq(schema.chunks.documentId, documentId))
      .orderBy(asc(schema.chunks.ordinal));

    return {
      document: rowToDocument(row),
      chunks: chunkRows.map(rowToChunk),
    };
  }

  async list(): Promise<readonly SafetyDocument[]> {
    const rows = await this.#db
      .select()
      .from(schema.documents)
      .orderBy(desc(schema.documents.uploadedAt));

    const documents: SafetyDocument[] = [];
    for (const row of rows) {
      try {
        documents.push(rowToDocument(row));
      } catch {
        continue;
      }
    }
    return documents;
  }
}

const localLibrary: DocumentLibrary = new LocalFileDocumentLibrary();

/** The other line Cluster D changed. */
export async function getDocumentLibrary(): Promise<DocumentLibrary> {
  const db = await getDb();
  if (db !== null) return new D1DocumentLibrary(db);

  if (await hasLocalDisk()) return localLibrary;

  return ephemeralSingleton(
    "document_library",
    () => new EphemeralDocumentLibrary(),
  );
}

export type { DocumentChunk };

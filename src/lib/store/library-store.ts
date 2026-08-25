import "server-only";
import type { DocumentChunk, SafetyDocument } from "@/lib/schemas";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  nodeFs,
  nodePath,
  storageBacking,
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
 * call, and so lexical search works." The Vectorize half arrives in Cluster E.
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

const localLibrary: DocumentLibrary = new LocalFileDocumentLibrary();

/** The other line Cluster D changes. */
export function getDocumentLibrary(): DocumentLibrary {
  if (storageBacking() !== "ephemeral") return localLibrary;
  return ephemeralSingleton(
    "document_library",
    () => new EphemeralDocumentLibrary(),
  );
}

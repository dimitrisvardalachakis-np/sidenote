import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentChunk, SafetyDocument } from "@/lib/schemas";

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

const LIBRARY_DIR = join(process.cwd(), ".data", "library");

/** Document ids are uuids; anything else never becomes a filename. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class LocalFileDocumentLibrary implements DocumentLibrary {
  async save(entry: LibraryEntry): Promise<void> {
    if (!UUID.test(entry.document.id)) {
      throw new Error(`Refusing a document id that is not a uuid: ${entry.document.id}`);
    }
    await mkdir(LIBRARY_DIR, { recursive: true });
    await writeFile(
      join(LIBRARY_DIR, `${entry.document.id}.json`),
      JSON.stringify(entry, null, 2),
      "utf8",
    );
  }

  async get(documentId: string): Promise<LibraryEntry | null> {
    if (!UUID.test(documentId)) return null;
    try {
      const raw = await readFile(
        join(LIBRARY_DIR, `${documentId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as LibraryEntry;
    } catch {
      return null;
    }
  }

  async list(): Promise<readonly SafetyDocument[]> {
    const names = await readdir(LIBRARY_DIR).catch(() => []);
    const documents: SafetyDocument[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(join(LIBRARY_DIR, name), "utf8").catch(
        () => null,
      );
      if (raw === null) continue;
      const entry = JSON.parse(raw) as LibraryEntry;
      documents.push(entry.document);
    }
    // Newest first: the reviewer who just uploaded something looks at the top.
    return documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
}

const library: DocumentLibrary = new LocalFileDocumentLibrary();

/** The other line Cluster D changes. */
export function getDocumentLibrary(): DocumentLibrary {
  return library;
}

import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IsoDateTime } from "@/lib/schemas";

/**
 * DocumentStore — where the original uploaded bytes live.
 *
 * Shaped deliberately like R2Bucket: put(key, bytes), get(key), list(prefix).
 * Cluster D replaces LocalFileDocumentStore with a class that forwards to an
 * R2 binding and changes one line in getDocumentStore(). No component, page
 * or action learns the difference, which is the whole point of the brief's
 * "so Cluster D can swap in R2 without touching the UI".
 *
 * Two things stay true across both implementations:
 *
 * 1. The application only ever holds the OBJECT KEY. The bytes are written
 *    once and read back only to serve a download. CLAUDE.md is explicit that
 *    the Worker stores the key and nothing else.
 * 2. In Cluster D the browser PUTs to a presigned URL directly and these
 *    bytes never pass through application code at all. Locally there is no
 *    presigning, so the file travels through a Server Action instead — which
 *    is why next.config.ts raises the action body limit. That limit exists
 *    only because of this gap and should be deleted along with it.
 */

export interface StoredObject {
  readonly key: string;
  readonly byteLength: number;
  readonly contentType: string;
  readonly filename: string;
  readonly storedAt: IsoDateTime;
}

export interface DocumentStore {
  put(
    key: string,
    bytes: Uint8Array,
    meta: { readonly contentType: string; readonly filename: string },
  ): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix?: string): Promise<readonly StoredObject[]>;
}

const OBJECTS_DIR = join(process.cwd(), ".data", "objects");

/**
 * Object keys become path segments on this implementation, so a key is not
 * merely a name — it is untrusted input that gets concatenated onto a
 * filesystem path. Anything outside this shape is refused before it touches
 * the disk. R2 would not care; the local store very much does.
 */
const SAFE_KEY = /^[a-z]+\/[A-Za-z0-9._-]+$/;

export class UnsafeObjectKeyError extends Error {
  constructor(key: string) {
    super(`Refusing an object key that is not a simple prefix/name: ${key}`);
    this.name = "UnsafeObjectKeyError";
  }
}

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) {
    throw new UnsafeObjectKeyError(key);
  }
}

/** `company/3f2a…-ccds.pdf`. The prefix is the namespace, as in Vectorize. */
export function objectKeyFor(
  sourceType: "company" | "public",
  documentId: string,
  filename: string,
): string {
  const dot = filename.lastIndexOf(".");
  const extension = dot > 0 ? filename.slice(dot).toLowerCase() : "";
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
  return `${sourceType}/${documentId}${safeExtension}`;
}

class LocalFileDocumentStore implements DocumentStore {
  async put(
    key: string,
    bytes: Uint8Array,
    meta: { contentType: string; filename: string },
  ): Promise<StoredObject> {
    assertSafeKey(key);
    const path = join(OBJECTS_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);

    const stored: StoredObject = {
      key,
      byteLength: bytes.byteLength,
      contentType: meta.contentType,
      filename: meta.filename,
      storedAt: new Date().toISOString(),
    };
    // R2 carries this as object metadata; the local store needs a sidecar.
    await writeFile(`${path}.meta.json`, JSON.stringify(stored, null, 2), "utf8");
    return stored;
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    try {
      return new Uint8Array(await readFile(join(OBJECTS_DIR, key)));
    } catch {
      return null;
    }
  }

  async list(prefix?: string): Promise<readonly StoredObject[]> {
    const prefixes = await readdir(OBJECTS_DIR, { withFileTypes: true }).catch(
      () => [],
    );
    const objects: StoredObject[] = [];
    for (const entry of prefixes) {
      if (!entry.isDirectory()) continue;
      if (prefix !== undefined && !entry.name.startsWith(prefix)) continue;
      const names = await readdir(join(OBJECTS_DIR, entry.name)).catch(() => []);
      for (const name of names) {
        if (!name.endsWith(".meta.json")) continue;
        const raw = await readFile(
          join(OBJECTS_DIR, entry.name, name),
          "utf8",
        ).catch(() => null);
        if (raw !== null) objects.push(JSON.parse(raw) as StoredObject);
      }
    }
    return objects.sort((a, b) => a.storedAt.localeCompare(b.storedAt));
  }
}

const store: DocumentStore = new LocalFileDocumentStore();

/** The one line Cluster D changes. */
export function getDocumentStore(): DocumentStore {
  return store;
}

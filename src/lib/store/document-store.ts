import "server-only";
import type { IsoDateTime } from "@/lib/schemas";
import { getCloudflareEnv } from "@/lib/platform/env";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  nodeFs,
  nodePath,
  storageBacking,
} from "./backing";

/**
 * DocumentStore — where the original uploaded bytes live.
 *
 * Shaped deliberately like R2Bucket: put(key, bytes), get(key), list(prefix).
 * Cluster D replaces both implementations below with one class that forwards
 * to an R2 binding and changes one line in getDocumentStore(). No component,
 * page or action learns the difference, which is the whole point of the
 * brief's "so Cluster D can swap in R2 without touching the UI".
 *
 * Two things stay true across every implementation:
 *
 * 1. The application only ever holds the OBJECT KEY. The bytes are written
 *    once and read back only to serve a download. CLAUDE.md is explicit that
 *    the Worker stores the key and nothing else.
 * 2. The browser PUTs to a presigned URL directly when R2's S3 credentials
 *    are configured, and those bytes never pass through application code at
 *    all — see lib/store/presign.ts. Without them the file travels through a
 *    Server Action instead, which is why next.config.ts still raises the
 *    action body limit: it is the size cap on the FALLBACK path.
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

/**
 * Object keys become path segments on the local implementation, so a key is
 * not merely a name — it is untrusted input that gets concatenated onto a
 * filesystem path. Anything outside this shape is refused before it touches
 * the disk. R2 would not care; the local store very much does.
 *
 * Enforced on the ephemeral store too, even though a Map cannot be escaped
 * from. A validation that only runs on one implementation is a validation that
 * disappears the day the other one is the default, and the bug it was written
 * to stop comes back on the runtime nobody tested it on.
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
    meta: { readonly contentType: string; readonly filename: string },
  ): Promise<StoredObject> {
    assertSafeKey(key);
    const { mkdir, writeFile } = await nodeFs();
    const { dirname, join } = await nodePath();
    const path = join(await dataPath("objects"), key);
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
    const { readFile } = await nodeFs();
    const { join } = await nodePath();
    try {
      return new Uint8Array(await readFile(join(await dataPath("objects"), key)));
    } catch {
      return null;
    }
  }

  async list(prefix?: string): Promise<readonly StoredObject[]> {
    const { readFile, readdir } = await nodeFs();
    const { join } = await nodePath();
    const root = await dataPath("objects");
    const prefixes = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    const objects: StoredObject[] = [];
    for (const entry of prefixes) {
      if (!entry.isDirectory()) continue;
      if (prefix !== undefined && !entry.name.startsWith(prefix)) continue;
      const names = await readdir(join(root, entry.name)).catch(() => []);
      for (const name of names) {
        if (!name.endsWith(".meta.json")) continue;
        const raw = await readFile(join(root, entry.name, name), "utf8").catch(
          () => null,
        );
        if (raw !== null) objects.push(JSON.parse(raw) as StoredObject);
      }
    }
    return objects.sort((a, b) => a.storedAt.localeCompare(b.storedAt));
  }
}

/**
 * Workers, until Cluster D binds R2.
 *
 * Holds the bytes in the isolate, which is the least defensible of the three
 * ephemeral stores in memory terms — a 12MB CCDS is 12MB of isolate. It is
 * bounded by the fact that Workers recycles isolates and by the same upload
 * limit the local path has, and it is temporary by construction: R2 is one
 * cluster away and this class is deleted when it lands.
 */
class EphemeralDocumentStore implements DocumentStore {
  readonly #objects = new Map<string, { bytes: Uint8Array; meta: StoredObject }>();

  async put(
    key: string,
    bytes: Uint8Array,
    meta: { readonly contentType: string; readonly filename: string },
  ): Promise<StoredObject> {
    assertSafeKey(key);
    const stored: StoredObject = {
      key,
      byteLength: bytes.byteLength,
      contentType: meta.contentType,
      filename: meta.filename,
      storedAt: new Date().toISOString(),
    };
    // Copied, not referenced. The caller built this from a request body it is
    // free to reuse, and a store that hands back a view of somebody else's
    // buffer is a bug that shows up as corrupted downloads much later.
    this.#objects.set(key, { bytes: new Uint8Array(bytes), meta: stored });
    announceEphemeralWrite("document_store", key);
    return stored;
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    const found = this.#objects.get(key);
    return found === undefined ? null : new Uint8Array(found.bytes);
  }

  async list(prefix?: string): Promise<readonly StoredObject[]> {
    return [...this.#objects.values()]
      .map((entry) => entry.meta)
      .filter((meta) => prefix === undefined || meta.key.startsWith(prefix))
      .sort((a, b) => a.storedAt.localeCompare(b.storedAt));
  }
}

/**
 * R2. The real one.
 *
 * Thin on purpose — the DocumentStore interface was shaped like R2Bucket from
 * the start (put/get/list with a prefix), so this class is mostly a change of
 * spelling. That was the bet Cluster A made when it kept this separate from
 * DocumentLibrary, and it paid: no component, page or action changed.
 *
 * `httpMetadata` and `customMetadata` are R2's own fields, so the sidecar
 * `.meta.json` file the local implementation has to write disappears here. One
 * fewer object per document, and no possibility of the two drifting apart.
 */
class R2DocumentStore implements DocumentStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async put(
    key: string,
    bytes: Uint8Array,
    meta: { readonly contentType: string; readonly filename: string },
  ): Promise<StoredObject> {
    // Kept even though R2 has no filesystem to escape from. The key format is
    // also the confidentiality namespace — `company/` or `public/` — and a key
    // that does not match the shape is a key whose namespace we cannot vouch
    // for. That matters more here than it did on disk, not less.
    assertSafeKey(key);

    const object = await this.#bucket.put(key, bytes, {
      httpMetadata: { contentType: meta.contentType },
      customMetadata: { filename: meta.filename },
    });

    return {
      key,
      byteLength: bytes.byteLength,
      contentType: meta.contentType,
      filename: meta.filename,
      storedAt: (object?.uploaded ?? new Date()).toISOString(),
    };
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    const object = await this.#bucket.get(key);
    if (object === null) return null;
    return new Uint8Array(await object.arrayBuffer());
  }

  async list(prefix?: string): Promise<readonly StoredObject[]> {
    const listed = await this.#bucket.list(
      prefix === undefined ? undefined : { prefix },
    );

    return listed.objects
      .map((object) => ({
        key: object.key,
        byteLength: object.size,
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
        filename: object.customMetadata?.["filename"] ?? object.key,
        storedAt: object.uploaded.toISOString(),
      }))
      .sort((a, b) => a.storedAt.localeCompare(b.storedAt));
  }
}

const localStore: DocumentStore = new LocalFileDocumentStore();

/** The one line Cluster D changed: R2 when the bucket is bound. */
export async function getDocumentStore(): Promise<DocumentStore> {
  const env = await getCloudflareEnv();
  const bucket = env?.DOCUMENTS;
  if (bucket !== undefined) return new R2DocumentStore(bucket);

  if ((await storageBacking()) !== "ephemeral") return localStore;

  return ephemeralSingleton("document_store", () => new EphemeralDocumentStore());
}

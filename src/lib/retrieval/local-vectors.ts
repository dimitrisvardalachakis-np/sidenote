/**
 * Brute-force cosine over a local file. The default vector store.
 *
 * Vectorize is the architecture CLAUDE.md describes, and this is not it. It is
 * here because the alternative — semantic search that does nothing until
 * somebody creates a remote index, adds a token permission and runs a backfill
 * — means the dense half sits dark for everyone who has not done that yet, and
 * a feature that is off by default is a feature nobody reviews. The same
 * argument produced the HTTP model client: make it run everywhere with the
 * credentials already in hand, and let the scale option be opt-in.
 *
 * The ceiling is real and stated in the resolver's `reason` string, so it
 * reaches a screen rather than living only in this comment: every query reads
 * every vector, which is microseconds at fixture scale and painful at 10^5.
 */
import type { ChunkId, DocumentId, SourceType } from "@/lib/schemas";
import { seedVectorRecords } from "@/lib/fixtures/vectors";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/assess/ai";
import type {
  VectorMatch,
  VectorMetadata,
  VectorQuery,
  VectorRecord,
  VectorStore,
} from "./vectors";
import type { Vector } from "./embed";

/** Where uploaded documents' vectors live. Mirrors `library-store.ts`. */
const VECTOR_DIR = ".data/vectors";

/**
 * What produced the vectors in a file, so a run cannot read another's.
 *
 * THE PROBLEM THIS SOLVES. `scripts/stub-model.mjs` answers embedding requests
 * by hashing words into buckets. That is deliberate and it makes the whole
 * chain testable offline — but the vectors it returns live in the same
 * directory, under the same filenames, as vectors from the real model, and the
 * writer cannot tell which it just talked to. Develop against the stub, switch
 * to real credentials, and every query then scores a real query vector against
 * a file of hashed buckets: confident rankings over noise, with nothing
 * anywhere saying so.
 *
 * `fixtures/vectors.ts` refuses exactly this for the seed artifact, on the
 * grounds that a file must never claim an inference that did not happen. This
 * is the same rule for the uploaded half, and it has to be enforced in code
 * rather than documented, because the failure is silent and the person who
 * hits it has no reason to suspect the directory.
 *
 * So the tell — whether the model endpoint was overridden — is stamped into
 * each file and checked on read. A mismatched file is skipped, which degrades
 * that document to lexical-only rather than poisoning the ranking.
 */
export function provenanceOf(env: Readonly<Record<string, unknown>>): string {
  const override = env["SIDENOTE_AI_BASE_URL"];
  return typeof override === "string" && override.trim().length > 0
    ? `override:${override.trim()}`
    : "workers-ai";
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True cosine, with a zero-norm guard.
 *
 * bge returns normalised vectors in practice, so the denominator is usually 1
 * — but "in practice" is an unverifiable assumption about a remote model, and
 * the division costs nothing. A zero vector has no direction; scoring it 0 is
 * the honest answer rather than NaN.
 */
export function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

interface StoredFile {
  readonly documentId: string;
  readonly model: string;
  readonly dimensions: number;
  /** See `provenanceOf`. Absent in files written before this check existed. */
  readonly source?: string;
  readonly vectors: readonly {
    readonly id: string;
    readonly sourceType: SourceType;
    readonly activeSubstance: string;
    readonly values: readonly number[];
  }[];
}

/**
 * `node:fs` is imported lazily, inside the methods that need it.
 *
 * Stricter than `library-store.ts`, which imports at the top. The reason is
 * that this module is reachable from `resolveVectorStore`, which must stay
 * synchronous and importable on Workers — where there is no filesystem, the
 * read throws, the catch yields nothing, and the store serves the bundled seed
 * vectors. Three lines to keep the resolver's shape identical to
 * `resolveAiBinding`'s.
 */
async function readUploadedVectors(
  provenance: string,
): Promise<readonly VectorRecord[]> {
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const names = await readdir(VECTOR_DIR);
    const out: VectorRecord[] = [];

    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      if (!UUID.test(name.slice(0, -".json".length))) continue;

      try {
        const raw = await readFile(join(VECTOR_DIR, name), "utf8");
        const file = JSON.parse(raw) as StoredFile;

        /*
          Three reasons to skip a file, and all three are the same reason:
          these vectors are not in the same space as the query vector this
          store is about to be handed. Mixing spaces does not fail — it ranks,
          confidently, over noise. Skipping degrades the document to
          lexical-only, which is visible in its "chunked, not embedded" status
          and is the honest outcome.

          `source` is optional so a file written before this check existed is
          not silently discarded; a missing value means "written by whatever
          was configured then", which is the best that can be said about it.
        */
        if (file.model !== EMBEDDING_MODEL) continue;
        if (file.dimensions !== EMBEDDING_DIMENSIONS) continue;
        if (file.source !== undefined && file.source !== provenance) continue;

        for (const entry of file.vectors) {
          out.push({
            id: entry.id as ChunkId,
            values: entry.values,
            metadata: {
              documentId: file.documentId as DocumentId,
              sourceType: entry.sourceType,
              activeSubstance: entry.activeSubstance,
            },
          });
        }
      } catch {
        // One unreadable or half-written file must not blind the whole index.
        // The document stays lexically searchable and its status still says
        // what it is.
        continue;
      }
    }

    return out;
  } catch {
    // No directory, or no filesystem at all. Seeds only.
    return [];
  }
}

class LocalVectorStore implements VectorStore {
  readonly kind = "local" as const;
  readonly #provenance: string;

  constructor(provenance: string) {
    this.#provenance = provenance;
  }

  async upsert(records: readonly VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    /*
      Grouped by document and written one file per document, so a re-upload
      replaces that document's vectors wholesale rather than leaving the
      orphans of a previous chunking behind. Same rationale, and the same
      filename guard, as library-store.ts.
    */
    const byDocument = new Map<string, VectorRecord[]>();
    for (const record of records) {
      const key = record.metadata.documentId;
      const bucket = byDocument.get(key);
      if (bucket === undefined) byDocument.set(key, [record]);
      else bucket.push(record);
    }

    await mkdir(VECTOR_DIR, { recursive: true });

    for (const [documentId, group] of byDocument) {
      if (!UUID.test(documentId)) continue;
      const first = group[0];
      if (first === undefined) continue;

      const file: StoredFile = {
        documentId,
        // The shared constant, not a literal: a hardcoded name silently
        // becomes a false claim the moment EMBEDDING_MODEL changes, and this
        // field is now checked rather than decorative.
        model: EMBEDDING_MODEL,
        dimensions: first.values.length,
        source: this.#provenance,
        vectors: group.map((r) => ({
          id: r.id,
          sourceType: r.metadata.sourceType,
          activeSubstance: r.metadata.activeSubstance,
          values: [...r.values],
        })),
      };

      await writeFile(
        join(VECTOR_DIR, `${documentId}.json`),
        JSON.stringify(file),
        "utf8",
      );
    }
  }

  async query(query: VectorQuery): Promise<readonly VectorMatch[]> {
    const [seeded, uploaded] = await Promise.all([
      seedVectorRecords(),
      readUploadedVectors(this.#provenance),
    ]);

    // Uploaded wins on an id collision, exactly as loadCorpus merges uploaded
    // chunks over seeded ones.
    const merged = new Map<string, VectorRecord>();
    for (const record of seeded) merged.set(record.id, record);
    for (const record of uploaded) merged.set(record.id, record);

    const matches: VectorMatch[] = [];

    for (const record of merged.values()) {
      /*
        Filter BEFORE scoring, not after topK.

        Vectorize applies its metadata filter before the search and takes topK
        from the filtered set. Matching that here means the two implementations
        return the same answer for the same input, rather than differing by
        whether the topK budget was spent on rejects.
      */
      if (record.metadata.sourceType !== query.sourceType) continue;
      if (!query.documentIds.has(record.metadata.documentId)) continue;

      matches.push({
        id: record.id,
        score: cosine(query.vector, record.values),
        metadata: record.metadata satisfies VectorMetadata,
      });
    }

    return matches
      .sort((a, b) =>
        // Deterministic tie-break, the same convention as lexicalSearch.
        b.score === a.score ? a.id.localeCompare(b.id) : b.score - a.score,
      )
      .slice(0, query.topK);
  }
}

/**
 * `provenance` defaults to the real endpoint, which is the safe default: a
 * caller that does not pass one gets vectors labelled as coming from Workers
 * AI, and only a caller that has actually overridden the endpoint can write
 * anything else.
 */
export function createLocalVectorStore(
  provenance = "workers-ai",
): VectorStore {
  return new LocalVectorStore(provenance);
}

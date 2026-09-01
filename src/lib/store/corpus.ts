import "server-only";
import type { DocumentChunk, SafetyDocument } from "@/lib/schemas";
import {
  SEED_CHUNKS,
  SEED_DOCUMENTS,
  SEED_PRODUCTS,
} from "@/lib/fixtures/documents";
import { getDocumentLibrary } from "./library-store";

/**
 * Everything retrieval can search: the seeded documents plus anything a
 * reviewer has uploaded.
 *
 * Merged rather than either-or, so a fresh checkout has a working demo and an
 * upload immediately becomes searchable.
 *
 * Still an array, and still every chunk. The dense half does not change that
 * and could not: `dense.ts` hydrates its matches from this corpus and refuses
 * anything the corpus does not confirm, so retrieval needs the whole mirror in
 * hand regardless of where the ranking came from. What Cluster E replaces is
 * how the array is produced — a D1 FTS5 query rather than a filesystem read —
 * not the fact that callers get one.
 */
export interface Corpus {
  readonly chunks: readonly DocumentChunk[];
  readonly documents: readonly SafetyDocument[];
  /** Names the intake chat matches against, so it never invents a drug. */
  readonly products: readonly string[];
}

export async function loadCorpus(): Promise<Corpus> {
  const library = await await getDocumentLibrary();
  const stored = await library.list();

  /*
    A seeded document can ALSO have a stored record, and then there is exactly
    one of it. Same shape as `loadQueue`'s handling of the seeded cases, and
    for the same reason — two rows for one document is the duplicated-evidence
    bug `findDuplicate` exists to prevent, arriving by a different door.

    WHICH HALF WINS IS SPLIT, and deliberately. The RECORD comes from the
    stored row, because the only thing that writes one for a fixture is the
    backfill, and the only thing it changes is `status: "embedded"` — a fact
    about whether the vectors reached the index, which the fixture literal
    cannot know because it differs per environment. The CHUNKS still come from
    `SEED_CHUNKS`, because those are built by `chunkDocument` at module load
    and are the single source of the text every citation is checked against.
  */
  const seededIds = new Set(SEED_DOCUMENTS.map((doc) => doc.id));
  const storedById = new Map(stored.map((doc) => [doc.id, doc]));

  const chunks: DocumentChunk[] = [...SEED_CHUNKS];
  const products = new Set<string>(SEED_PRODUCTS);

  for (const document of stored) {
    products.add(document.activeSubstance);
    // A fixture's chunks are already in the list above; taking them from the
    // library too would put every seeded passage in retrieval twice.
    if (seededIds.has(document.id)) continue;
    // Title words are not products; only the substance is reliable.
    const entry = await library.get(document.id);
    if (entry !== null) chunks.push(...entry.chunks);
  }

  return {
    chunks,
    documents: [
      ...SEED_DOCUMENTS.map((doc) => storedById.get(doc.id) ?? doc),
      ...stored.filter((doc) => !seededIds.has(doc.id)),
    ],
    products: [...products],
  };
}

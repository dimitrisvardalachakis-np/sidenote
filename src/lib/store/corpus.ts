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
 * upload immediately becomes searchable. Retrieval no longer goes through
 * here when D1 is bound — see lib/retrieval/hybrid.ts, which queries FTS5 and
 * Vectorize — but this stays as the corpus for a laptop with nothing bound,
 * and as the source of the product names the intake chat matches against.
 */
export interface Corpus {
  readonly chunks: readonly DocumentChunk[];
  readonly documents: readonly SafetyDocument[];
  /** Names the intake chat matches against, so it never invents a drug. */
  readonly products: readonly string[];
}

export async function loadCorpus(): Promise<Corpus> {
  const library = await getDocumentLibrary();
  const uploaded = await library.list();

  const chunks: DocumentChunk[] = [...SEED_CHUNKS];
  const products = new Set<string>(SEED_PRODUCTS);

  for (const document of uploaded) {
    products.add(document.activeSubstance);
    // Title words are not products; only the substance is reliable.
    const entry = await library.get(document.id);
    if (entry !== null) chunks.push(...entry.chunks);
  }

  return {
    chunks,
    documents: [...SEED_DOCUMENTS, ...uploaded],
    products: [...products],
  };
}

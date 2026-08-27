import "server-only";
/**
 * Embedding a document's chunks and putting them in the index.
 *
 * The rule this file enforces is the one that keeps `"embedded"` from becoming
 * a lie:
 *
 *   A document is only marked embedded when its vectors are actually in the
 *   index. Every other outcome leaves it at `"chunking"`, which is honest —
 *   the chunks are mirrored, the document is lexically searchable, and the
 *   library screen says exactly that.
 *
 * `"embedded"` is a status nothing in this codebase could previously set, and
 * the comment at the old call site said marking it would be "a lie a later
 * cluster has to unpick". The way to stop it becoming that lie again is not a
 * comment; it is that the only code path which writes it is downstream of an
 * `upsert` that resolved.
 *
 * ORDER MATTERS, AND NOT SYMMETRICALLY.
 *
 * The library entry is saved BEFORE this runs. A document in the library but
 * not the index is a degradation: it is lexically searchable and honestly
 * labelled. A document in the index but not the library is a vector that can
 * never be hydrated — `dense.ts` drops it, so it is not dangerous, but it is
 * garbage that accumulates and that nothing ever cleans up. Given a crash
 * between the two, the first is strictly better, so the mirror is written
 * first and the status corrected afterwards.
 */
import type { DocumentChunk, SafetyDocument } from "@/lib/schemas";
import { embedTextFor } from "./embed";
import type { DenseAvailability, VectorRecord } from "./vectors";

export type IngestOutcome =
  | { readonly status: "embedded"; readonly vectors: number }
  /**
   * Not an error state. Semantic search is off, or unconfigured, or the model
   * is unavailable — the document is still chunked, mirrored and searchable.
   */
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string };

export interface IngestInput {
  readonly dense: DenseAvailability | null;
  readonly document: Pick<SafetyDocument, "id" | "sourceType" | "activeSubstance">;
  readonly chunks: readonly DocumentChunk[];
}

/**
 * Embed and upsert. Never throws; the outcome says what happened.
 *
 * The caller has already saved the library entry, so every branch below leaves
 * a usable document behind. What differs is only whether the dense half can
 * see it, and what the status and the audit line say about that.
 */
export async function embedAndUpsert(
  input: IngestInput,
): Promise<IngestOutcome> {
  const { dense, document, chunks } = input;

  if (dense === null || dense.embedder === null || dense.store === null) {
    return {
      status: "skipped",
      reason: dense?.reason ?? "semantic retrieval is not configured",
    };
  }
  if (chunks.length === 0) {
    return { status: "skipped", reason: "the document produced no chunks" };
  }

  try {
    const vectors = await dense.embedder.embed(chunks.map(embedTextFor));

    /*
      Belt and braces on the count.

      `createEmbedder` already throws on a batch count mismatch, and this is
      the same check one layer up — deliberately, because the consequence of
      getting it wrong is not an error but a permanently mis-ranked index. The
      zip below is where a shifted array would become wrong vectors attached to
      real chunk ids, and that is worth two checks rather than one.
    */
    if (vectors.length !== chunks.length) {
      return {
        status: "failed",
        reason: `embedding count mismatch: ${chunks.length} chunks produced ${vectors.length} vectors`,
      };
    }

    const records: VectorRecord[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const values = vectors[index];
      // `noUncheckedIndexedAccess` forces this to be narrowed rather than
      // asserted, which is the point: the check above makes it unreachable,
      // and a `!` here would be the assumption rather than the guarantee.
      if (values === undefined) continue;
      records.push({
        id: chunk.id,
        values,
        metadata: {
          documentId: document.id,
          sourceType: document.sourceType,
          activeSubstance: document.activeSubstance,
        },
      });
    }

    await dense.store.upsert(records);
    return { status: "embedded", vectors: records.length };
  } catch (cause) {
    return {
      status: "failed",
      reason:
        cause instanceof Error
          ? cause.message
          : "the vectors could not be written to the index",
    };
  }
}

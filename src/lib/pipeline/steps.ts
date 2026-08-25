import "server-only";
import { eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { EMBEDDING_BATCH_SIZE, embed } from "@/lib/ai/embeddings";
import { namespaceFor, upsertVectors } from "@/lib/ai/vectorize";
import { getDb, schema } from "@/lib/db/client";
import { chunkDocument } from "@/lib/ingest/chunk";
import { hybridSearch } from "@/lib/retrieval/hybrid";
import { toCitation, type ScoredChunk } from "@/lib/retrieval/search";
import { getCaseStore } from "@/lib/store/case-store";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { getDocumentStore } from "@/lib/store/document-store";
import { saveAssessment } from "@/lib/db/assessments";
import {
  Assessment,
  AssessmentId,
  SafetyDocument,
  type Citation,
  type ExpectednessFinding,
  type ListednessFinding,
} from "@/lib/schemas";
import type { IngestMessage } from "./messages";

/**
 * The pipeline, one step per message.
 *
 * CLAUDE.md: "Extract → chunk → embed → dedupe → assess". Extraction happens in
 * the browser and everything after it happens here.
 *
 * EACH STEP RETURNS ITS FOLLOW-UPS RATHER THAN ENQUEUING THEM.
 *
 * That is not a style preference. A step that enqueues directly needs the queue
 * binding, which makes it untestable without one and makes this module and the
 * producer import each other. Returning the next messages keeps every step a
 * function from a message to a list of messages — trivially testable, and the
 * caller decides whether "next" means the queue or an immediate call.
 */

export async function runStep(
  message: IngestMessage,
): Promise<readonly IngestMessage[]> {
  switch (message.kind) {
    case "chunk_document":
      return chunkStep(message.documentId, message.textKey);
    case "embed_document":
      return embedStep(message.documentId);
    case "assess_case":
      return assessStep(message.caseId);
  }
}

// ---------------------------------------------------------------------------
// chunk
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the chunk text, for the dedupe step.
 *
 * WebCrypto rather than a hand-rolled hash: it is on Workers and in Node, it is
 * not going to collide, and a cheap 32-bit hash that collides once in a corpus
 * of a hundred thousand chunks would silently give two different passages the
 * same embedding.
 */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function chunkStep(
  documentId: string,
  textKey: string,
): Promise<readonly IngestMessage[]> {
  const library = await getDocumentLibrary();
  const entry = await library.get(documentId);
  if (entry === null) {
    // The document record went away between enqueue and now. Nothing to do,
    // and retrying will not bring it back — so this returns rather than
    // throwing, which would send a permanently-doomed message to the DLQ.
    audit({
      actor: "system",
      action: "chunk_document",
      target: documentId,
      outcome: "failure",
      detail: { reason: "document_not_found" },
    });
    return [];
  }

  const store = await getDocumentStore();
  const bytes = await store.get(textKey);
  if (bytes === null) {
    throw new Error(`Extracted text ${textKey} is not in the object store`);
  }

  const text = new TextDecoder().decode(bytes);
  const chunks = chunkDocument(text, {
    documentId: entry.document.id,
    sourceType: entry.document.sourceType,
  });

  const document = SafetyDocument.parse({
    ...entry.document,
    status: chunks.length === 0 ? "rejected" : "chunked",
    rejectionReason: chunks.length === 0 ? "empty_document" : null,
    chunkCount: chunks.length,
  });

  await library.save({ document, chunks });

  // The hash is written after the library save, because the library interface
  // deals in DocumentChunks and the hash is a storage concern. One extra
  // statement rather than a domain type that carries a database detail.
  const db = await getDb();
  if (db !== null && chunks.length > 0) {
    await Promise.all(
      chunks.map(async (chunk) =>
        db
          .update(schema.chunks)
          .set({ textHash: await sha256(chunk.text) })
          .where(eq(schema.chunks.id, chunk.id)),
      ),
    );
  }

  audit({
    actor: "system",
    action: "chunk_document",
    target: documentId,
    outcome: chunks.length === 0 ? "rejected" : "success",
    detail: { chunks: chunks.length },
  });

  return chunks.length === 0
    ? []
    : [{ kind: "embed_document", documentId: entry.document.id }];
}

// ---------------------------------------------------------------------------
// embed + dedupe
// ---------------------------------------------------------------------------

async function embedStep(
  documentId: string,
): Promise<readonly IngestMessage[]> {
  const db = await getDb();
  if (db === null) {
    audit({
      actor: "system",
      action: "embed_document",
      target: documentId,
      outcome: "failure",
      detail: { reason: "no_database" },
    });
    return [];
  }

  const rows = await db
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.documentId, documentId));

  const pending = rows.filter((row) => row.embeddedAt === null);
  if (pending.length === 0) return [];

  /**
   * THE DEDUPE STEP.
   *
   * Safety documents repeat themselves: a CCDS v7.2 is mostly a CCDS v7.1, and
   * a label revision changes two sections out of nine. Grouping by content hash
   * means the identical paragraph is embedded ONCE however many chunks carry
   * it, and every one of those chunks gets the same vector.
   *
   * Two things are saved, and the second matters more: the model call, and a
   * result list that would otherwise show a reviewer the same passage twice and
   * read as two independent pieces of evidence for one claim.
   */
  const byHash = new Map<string, typeof pending>();
  for (const row of pending) {
    const hash = row.textHash === "" ? await sha256(row.text) : row.textHash;
    const bucket = byHash.get(hash);
    if (bucket === undefined) byHash.set(hash, [row]);
    else bucket.push(row);
  }

  const unique = [...byHash.values()];
  const embeddedAt = new Date().toISOString();
  let upserted = 0;

  for (let i = 0; i < unique.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = unique.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((group) => group[0]?.text ?? "");

    const result = await embed(texts);
    if (!result.ok) {
      audit({
        actor: "system",
        action: "embed_document",
        target: documentId,
        outcome: "failure",
        detail: { reason: result.reason, pending: pending.length },
      });
      // Thrown, not swallowed. Embedding is the step that can be rate limited
      // or time out, and those are exactly the failures a retry fixes. The
      // chunks stay `embeddedAt = null`, so a retry picks up where this left
      // off rather than redoing the whole document.
      throw new Error(`Embedding failed: ${result.reason}`);
    }

    const vectors = batch.flatMap((group, index) => {
      const values = result.vectors[index];
      if (values === undefined) return [];
      return group.map((row) => ({
        id: row.id,
        values,
        namespace: namespaceFor(
          row.sourceType === "company" ? "company" : "public",
        ),
        metadata: {
          documentId: row.documentId,
          sourceType: row.sourceType,
          ordinal: row.ordinal,
        },
      }));
    });

    const upsert = await upsertVectors(vectors);
    if (!upsert.ok) {
      audit({
        actor: "system",
        action: "embed_document",
        target: documentId,
        outcome: "failure",
        detail: { reason: upsert.reason },
      });
      throw new Error(`Vectorize upsert failed: ${upsert.reason}`);
    }
    upserted += upsert.value;

    // Marked only after the vector is actually in the index. The other order
    // would leave chunks recorded as embedded that no search can find, and
    // nothing would ever try again.
    await db
      .update(schema.chunks)
      .set({ embeddedAt })
      .where(inArray(schema.chunks.id, vectors.map((v) => v.id)));
  }

  audit({
    actor: "system",
    action: "embed_document",
    target: documentId,
    outcome: "success",
    detail: {
      chunks: pending.length,
      embedded: unique.length,
      deduplicated: pending.length - unique.length,
      upserted,
    },
  });

  return [];
}

// ---------------------------------------------------------------------------
// assess
// ---------------------------------------------------------------------------

/**
 * Retrieval for one case, written down as an Assessment.
 *
 * NOT A DECISION. Non-negotiable #4: the model extracts, retrieves, drafts and
 * cites; the reviewer accepts or rejects. So `ruling` is left null and the
 * determinations below are `suggestedBy` the model — the case screen labels
 * them as suggestions, and the 15-day clock does not start until a human rules.
 */
async function assessStep(caseId: string): Promise<readonly IngestMessage[]> {
  const store = await getCaseStore();
  const record = await store.get(caseId);
  if (record === null) return [];

  const reaction = record.reactions[0];
  const drug = record.drugs.find((d) => d.role === "suspect") ?? record.drugs[0];
  if (reaction === undefined || drug === undefined) {
    // Two of the four validity criteria are missing, so there is nothing to
    // assess against. The case still exists and still shows as incomplete.
    return [];
  }

  const query = `${reaction.verbatimTerm} ${drug.activeSubstance ?? drug.reportedName}`;
  const now = new Date().toISOString();

  const [company, publicLabel] = await Promise.all([
    hybridSearch(query, "company", 3),
    hybridSearch(query, "public", 3),
  ]);

  const listedness: ListednessFinding = toListedness(company, query, now);
  const expectedness: ExpectednessFinding = toExpectedness(
    publicLabel,
    query,
    now,
  );

  const assessment = Assessment.parse({
    id: AssessmentId.parse(crypto.randomUUID()),
    caseId: record.id,
    reactionId: reaction.id,
    drugId: drug.id,
    listedness,
    expectedness,
    ruling: null,
    createdAt: now,
    updatedAt: now,
  });

  await saveAssessment(assessment);

  audit({
    actor: "system",
    action: "assess_case",
    target: record.reference,
    outcome: "success",
    detail: {
      listedness: listedness.state,
      expectedness: expectedness.state,
      degraded: company.degraded || publicLabel.degraded,
    },
  });

  return [];
}

/** Every hit becomes a citation: a chunk id and the quoted span (#3). */
function citationsOf(hits: readonly ScoredChunk[]): readonly Citation[] {
  return hits.map(toCitation);
}

function toListedness(
  result: Awaited<ReturnType<typeof hybridSearch>>,
  query: string,
  now: string,
): ListednessFinding {
  // "The search could not run" and "the search found nothing" are different
  // facts, and the second is a finding a reviewer may act on while the first is
  // not. Collapsing them would let an outage masquerade as a clean result.
  if (!result.lexical.ran && !result.dense.ran) {
    return {
      state: "source_unavailable",
      documentKind: "ccds",
      reason: `Retrieval could not run: ${result.lexical.reason}`,
      attemptedAt: now,
    };
  }

  if (result.hits.length === 0) {
    return {
      state: "no_result",
      documentKind: "ccds",
      query,
      retrievedAt: now,
    };
  }

  return {
    state: "grounded",
    determination: "listed",
    documentKind: "ccds",
    citations: [...citationsOf(result.hits)],
    suggestedBy: "model",
    retrievedAt: now,
  };
}

function toExpectedness(
  result: Awaited<ReturnType<typeof hybridSearch>>,
  query: string,
  now: string,
): ExpectednessFinding {
  if (!result.lexical.ran && !result.dense.ran) {
    return {
      state: "source_unavailable",
      reason: `Retrieval could not run: ${result.lexical.reason}`,
      attemptedAt: now,
    };
  }

  if (result.hits.length === 0) {
    return { state: "no_result", query, retrievedAt: now };
  }

  return {
    state: "grounded",
    determination: "expected",
    citations: [...citationsOf(result.hits)],
    suggestedBy: "model",
    labelSetId: null,
    retrievedAt: now,
  };
}

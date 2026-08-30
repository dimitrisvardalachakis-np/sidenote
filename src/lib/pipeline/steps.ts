import "server-only";
import { eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { getDb, schema } from "@/lib/db/client";
import { chunkDocument } from "@/lib/ingest/chunk";
import { assessCase } from "@/lib/assess/assess";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
import { aiEnv } from "@/lib/assess/env";
import { documentsForDrug } from "@/lib/assess/scope";
import { ensurePublicLabel, withAcquiredLabel } from "@/lib/labels/acquire";
import { EMBED_BATCH_SIZE, embedTextFor } from "@/lib/retrieval/embed";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { loadCorpus } from "@/lib/store/corpus";
import { getCaseStore } from "@/lib/store/case-store";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { getDocumentStore } from "@/lib/store/document-store";
import { saveAssessment } from "@/lib/db/assessments";
import {
  Assessment,
  AssessmentId,
  ChunkId,
  DocumentId,
  SafetyDocument,
} from "@/lib/schemas";
import type { VectorRecord } from "@/lib/retrieval/vectors";
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

  // `chunking`, not `chunked` — IngestionStatus is
  // pending / extracting / chunking / embedded / rejected, and there is no
  // past tense of chunking in it. Writing one threw inside SafetyDocument.parse,
  // which sent every uploaded document round the retry loop three times and
  // into the dead-letter queue. Caught in review, because the assess path was
  // verified end to end and this one never was.
  //
  // The document stays at `chunking` until embedStep upserts its vectors and
  // moves it to `embedded` — the status names the stage it is IN, not the last
  // one it finished.
  const document = SafetyDocument.parse({
    ...entry.document,
    status: chunks.length === 0 ? "rejected" : "chunking",
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

  /*
    The dense half, resolved the same way every other caller resolves it.

    Absent is not a failure and must not be a retry: with no model configured
    there is nothing a fourth attempt would fix, and the document is already
    chunked and mirrored, so it is lexically searchable and honestly labelled.
    Returning cleanly leaves it at `chunking`, which is what the library screen
    reads to say "keyword search only".
  */
  /*
    `activeSubstance` is vector metadata and lives on the document, not the
    chunk. Read once here rather than joined per row: every chunk in this loop
    belongs to the same document by construction.
  */
  const [documentRow] = await db
    .select({ activeSubstance: schema.documents.activeSubstance })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  const activeSubstance = documentRow?.activeSubstance ?? "";

  const env = await aiEnv();
  const dense = resolveDenseFor(env, resolveAiBinding(env));
  const embedder = dense.embedder;
  const store = dense.store;
  if (embedder === null || store === null) {
    audit({
      actor: "system",
      action: "embed_document",
      target: documentId,
      outcome: "rejected",
      detail: {
        reason: dense.reason ?? "semantic retrieval is not configured",
        pending: pending.length,
      },
    });
    return [];
  }

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

  for (let i = 0; i < unique.length; i += EMBED_BATCH_SIZE) {
    const batch = unique.slice(i, i + EMBED_BATCH_SIZE);

    /*
      `embedTextFor` rather than the raw text, so the queue embeds the exact
      string the reviewer path embeds. The two used to differ — this step sent
      `row.text` untouched while lib/retrieval prefixed and truncated it — and
      a vector produced from a different string than the query encoder expects
      is not wrong in any way a test would catch, only quietly worse at
      ranking.
    */
    let values: readonly (readonly number[])[];
    try {
      values = await embedder.embed(
        batch.map((group) =>
          embedTextFor({
            text: group[0]?.text ?? "",
            section: group[0]?.section ?? null,
          }),
        ),
      );
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      audit({
        actor: "system",
        action: "embed_document",
        target: documentId,
        outcome: "failure",
        detail: { reason, pending: pending.length },
      });
      // Thrown, not swallowed. Embedding is the step that can be rate limited
      // or time out, and those are exactly the failures a retry fixes. The
      // chunks stay `embeddedAt = null`, so a retry picks up where this left
      // off rather than redoing the whole document.
      throw new Error(`Embedding failed: ${reason}`);
    }

    const vectors = batch.flatMap((group, index) => {
      const vector = values[index];
      if (vector === undefined) return [];
      return group.map((row) => ({
        id: ChunkId.parse(row.id),
        values: vector,
        metadata: {
          documentId: DocumentId.parse(row.documentId),
          sourceType: row.sourceType === "company" ? "company" : "public",
          activeSubstance,
        },
      })) satisfies readonly VectorRecord[];
    });

    try {
      await store.upsert(vectors);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      audit({
        actor: "system",
        action: "embed_document",
        target: documentId,
        outcome: "failure",
        detail: { reason },
      });
      throw new Error(`Vector upsert failed: ${reason}`);
    }
    upserted += vectors.length;

    // Marked only after the vector is actually in the index. The other order
    // would leave chunks recorded as embedded that no search can find, and
    // nothing would ever try again.
    // `inArray` with an empty list builds `IN ()`, which is a syntax error
    // rather than a no-op. Reachable whenever a batch produced no vectors —
    // every group in it having been filtered out by the index guard above.
    const embeddedIds = vectors.map((v) => v.id);
    if (embeddedIds.length > 0) {
      await db
        .update(schema.chunks)
        .set({ embeddedAt })
        .where(inArray(schema.chunks.id, embeddedIds));
    }
  }

  // The document reaches `embedded` HERE and nowhere else — the status is a
  // claim about Vectorize, and only the step that upserted is entitled to make
  // it. Without this a fully-ingested document sat at `chunking` forever and
  // the library screen never showed it as usable.
  //
  // ONE COLUMN, NOT THE WHOLE ENTRY. `library.save()` deletes and re-inserts a
  // document's chunks from DocumentChunk values, and a DocumentChunk carries
  // neither `embeddedAt` nor `textHash` — they are storage bookkeeping, not
  // domain. Saving the entry back would therefore wipe the two columns this
  // step has just spent model calls filling in, and the next run would re-embed
  // the entire document and pay for all of them again.
  if (upserted > 0) {
    await db
      .update(schema.documents)
      .set({ status: "embedded" })
      .where(eq(schema.documents.id, documentId));
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

  /**
   * ONE PAIR, AND THAT IS A KNOWN LIMITATION RATHER THAN A DESIGN.
   *
   * Assessment is per reaction-drug pair — the same reaction against two drugs
   * is two questions with two answers, and the schema says so. This assesses
   * the first reaction against the first suspect drug and no others, so a case
   * reporting two reactions gets evidence for one of them.
   *
   * Written down rather than left to be discovered: the case screen renders a
   * single assessment, so the gap is invisible until somebody files a
   * multi-reaction report. Fixing it means the screen has to show several, and
   * that is a UI decision, not a pipeline one.
   */
  const reaction = record.reactions[0];
  const drug = record.drugs.find((d) => d.role === "suspect") ?? record.drugs[0];
  if (reaction === undefined || drug === undefined) {
    // Two of the four validity criteria are missing, so there is nothing to
    // assess against. The case still exists and still shows as incomplete.
    return [];
  }

  const now = new Date().toISOString();

  /*
    THE SAME ASSESSMENT THE REVIEWER'S BUTTON PRODUCES.

    This step used to build its own findings out of retrieval alone, and what
    it built was not an assessment: it hardcoded `determination: "listed"` for
    any case where retrieval returned a hit, stamped it `suggestedBy: "model"`
    though no model was ever called, and carried no reading and no narrative.
    A search result is not a verdict, and non-negotiable #4 says nothing but a
    reviewer writes one — so that path is gone rather than corrected, and the
    queue now calls `assessCase` exactly as the case screen does.

    The consequence worth naming: a case assessed by the queue and the same
    case assessed by a reviewer can no longer disagree, because there is one
    implementation instead of two.
  */
  const env = await aiEnv();
  const ai = resolveAiBinding(env);
  const dense = resolveDenseFor(env, ai);

  // The public label, fetched if we do not hold it. Never blocks: a failure
  // leaves the corpus as it was and expectedness degrades honestly.
  const beforeFetch = await loadCorpus();
  const label = await ensurePublicLabel({
    drugName: drug.activeSubstance ?? drug.reportedName,
    held: beforeFetch.documents,
    dense,
    actor: "system",
  });
  const { chunks, documents } =
    label.status === "acquired" ? await loadCorpus() : beforeFetch;

  const inScope = withAcquiredLabel(documentsForDrug(documents, drug), label);
  const publicDoc = documents.find(
    (d) => d.sourceType === "public" && inScope.has(d.id),
  );

  const { listedness, expectedness } = await assessCase({
    chunks,
    documentIds: inScope,
    reactionTerm: reaction.verbatimTerm,
    drugName: drug.reportedName,
    documentKind:
      drug.marketingStatus === "marketed" ? "ccds" : "investigators_brochure",
    labelSetId: publicDoc?.id ?? null,
    ai,
    dense,
    gateway: resolveGateway(env),
    now,
    actor: "system",
    target: record.reference,
  });

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
      dense: dense.source,
    },
  });

  return [];
}


import "server-only";
import {
  Case,
  DocumentChunk,
  SafetyDocument,
  isSerious,
  type Assessment,
} from "@/lib/schemas";
import * as schema from "./schema";

/**
 * Rows in, domain values out — and always through the zod schema.
 *
 * NOTHING LEAVES THIS FILE WITHOUT BEING PARSED. That is the rule fetchJson
 * enforces at the network boundary, applied at the database boundary, and for
 * the same reason: a row is bytes somebody else wrote. It may have been
 * written by a previous version of this schema, by a migration that half-ran,
 * or by hand during an incident. Casting it to `Case` would make all three of
 * those compile and fail later somewhere that says nothing about where the bad
 * data came from.
 *
 * The cost is that a stale row is REJECTED rather than rendered. That is the
 * intended behaviour, and the local stores already work that way.
 *
 * WHAT IS A COLUMN AND WHAT IS JSON is argued in schema.ts. The short version:
 * a value gets a column when something sorts or filters by it, and stays JSON
 * when it is a value object read back whole.
 */

export type CaseRow = typeof schema.cases.$inferSelect;
export type DrugRow = typeof schema.drugs.$inferSelect;
export type ReactionRow = typeof schema.reactions.$inferSelect;
export type DocumentRow = typeof schema.documents.$inferSelect;
export type ChunkRow = typeof schema.chunks.$inferSelect;

/** JSON in a TEXT column. Empty and absent are the same fact. */
function readJson(value: string | null): unknown {
  if (value === null || value === "") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // A column that is not JSON is corruption, not an empty value. Returning
    // null would quietly turn a broken patient record into "no patient", which
    // renders as a failed validity criterion — a clinical claim about the
    // report rather than a fault in our storage.
    throw new Error("A JSON column did not contain JSON");
  }
}

function writeJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Case — one aggregate across three tables
// ---------------------------------------------------------------------------

/**
 * Select types, not insert types, even though these are about to be inserted.
 *
 * The two differ only in optionality — insert lets a column with a DEFAULT be
 * omitted — and every field here is written explicitly anyway. Using the
 * stricter shape means `caseToRows` and `rowsToCase` are exact inverses and
 * can be round-tripped in a test without a cast, which is the only way to
 * prove the mapping does not quietly lose a field.
 */
export interface CaseRows {
  readonly caseRow: CaseRow;
  readonly drugRows: readonly DrugRow[];
  readonly reactionRows: readonly ReactionRow[];
}

export function caseToRows(record: Case): CaseRows {
  return {
    caseRow: {
      id: record.id,
      reference: record.reference,
      origin: record.origin,
      receivedAt: record.receivedAt,
      patient: writeJson(record.patient),
      reporter: writeJson(record.reporter),
      narrative: record.narrative,
      status: record.status,
      assignedTo: record.assignedTo,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    // `ordinal` preserves the reported order, which is information: the
    // first-named drug is usually the one the reporter blames, and a list that
    // comes back in whatever order SQLite felt like has lost that.
    drugRows: record.drugs.map((drug, ordinal) => ({
      id: drug.id,
      caseId: record.id,
      ordinal,
      reportedName: drug.reportedName,
      activeSubstance: drug.activeSubstance,
      role: drug.role,
      marketingStatus: drug.marketingStatus,
      dose: drug.dose,
      route: drug.route,
      indication: drug.indication,
      therapyStart: writeJson(drug.therapyStart),
      therapyEnd: writeJson(drug.therapyEnd),
      dechallenge: writeJson(drug.dechallenge),
      rechallenge: writeJson(drug.rechallenge),
    })),
    reactionRows: record.reactions.map((reaction, ordinal) => ({
      id: reaction.id,
      caseId: record.id,
      ordinal,
      verbatimTerm: reaction.verbatimTerm,
      meddraPreferredTerm: reaction.meddraPreferredTerm,
      onset: writeJson(reaction.onset),
      outcome: reaction.outcome,
      seriousness: writeJson(reaction.seriousness) ?? "{}",
      // Derived here by the same function the UI calls, so the column and the
      // JSON cannot hold different opinions about the same flags.
      serious: isSerious(reaction.seriousness),
    })),
  };
}

export function rowsToCase(
  caseRow: CaseRow,
  drugRows: readonly DrugRow[],
  reactionRows: readonly ReactionRow[],
): Case {
  return Case.parse({
    id: caseRow.id,
    reference: caseRow.reference,
    origin: caseRow.origin,
    receivedAt: caseRow.receivedAt,
    patient: readJson(caseRow.patient),
    reporter: readJson(caseRow.reporter),
    narrative: caseRow.narrative,
    status: caseRow.status,
    assignedTo: caseRow.assignedTo,
    createdAt: caseRow.createdAt,
    updatedAt: caseRow.updatedAt,
    drugs: [...drugRows]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((d) => ({
        id: d.id,
        reportedName: d.reportedName,
        activeSubstance: d.activeSubstance,
        role: d.role,
        marketingStatus: d.marketingStatus,
        dose: d.dose,
        route: d.route,
        indication: d.indication,
        therapyStart: readJson(d.therapyStart),
        therapyEnd: readJson(d.therapyEnd),
        dechallenge: readJson(d.dechallenge),
        rechallenge: readJson(d.rechallenge),
      })),
    reactions: [...reactionRows]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((r) => ({
        id: r.id,
        verbatimTerm: r.verbatimTerm,
        meddraPreferredTerm: r.meddraPreferredTerm,
        onset: readJson(r.onset),
        outcome: r.outcome,
        // `serious` is deliberately NOT read back. The flags are
        // authoritative and the column is an index; reading the index would
        // let a stale write become the answer to "is this case serious",
        // which starts — or fails to start — a 15-day clock.
        seriousness: readJson(r.seriousness),
      })),
  });
}

// ---------------------------------------------------------------------------
// Documents and chunks
// ---------------------------------------------------------------------------

export function documentToRow(
  document: SafetyDocument,
): typeof schema.documents.$inferInsert {
  return {
    id: document.id,
    title: document.title,
    kind: document.kind,
    sourceType: document.sourceType,
    activeSubstance: document.activeSubstance,
    version: document.version,
    effectiveDate: document.effectiveDate,
    objectKey: document.objectKey,
    status: document.status,
    rejectionReason: document.rejectionReason,
    chunkCount: document.chunkCount,
    uploadedAt: document.uploadedAt,
    contentHash: document.contentHash,
  };
}

export function rowToDocument(row: DocumentRow): SafetyDocument {
  return SafetyDocument.parse({
    id: row.id,
    title: row.title,
    kind: row.kind,
    sourceType: row.sourceType,
    activeSubstance: row.activeSubstance,
    version: row.version,
    effectiveDate: row.effectiveDate,
    objectKey: row.objectKey,
    status: row.status,
    rejectionReason: row.rejectionReason,
    chunkCount: row.chunkCount,
    uploadedAt: row.uploadedAt,
    contentHash: row.contentHash,
  });
}

export function chunkToRow(
  chunk: DocumentChunk,
): typeof schema.chunks.$inferInsert {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    sourceType: chunk.sourceType,
    section: chunk.section,
    ordinal: chunk.ordinal,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    tokenEstimate: chunk.tokenEstimate,
  };
}

export function rowToChunk(row: ChunkRow): DocumentChunk {
  return DocumentChunk.parse({
    id: row.id,
    documentId: row.documentId,
    sourceType: row.sourceType,
    section: row.section,
    ordinal: row.ordinal,
    text: row.text,
    charStart: row.charStart,
    charEnd: row.charEnd,
    tokenEstimate: row.tokenEstimate,
  });
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export function assessmentToRow(
  assessment: Assessment,
): typeof schema.assessments.$inferInsert {
  return {
    id: assessment.id,
    caseId: assessment.caseId,
    reactionId: assessment.reactionId,
    drugId: assessment.drugId,
    listedness: writeJson(assessment.listedness) ?? "{}",
    expectedness: writeJson(assessment.expectedness) ?? "{}",
    ruling: writeJson(assessment.ruling),
    createdAt: assessment.createdAt,
    updatedAt: assessment.updatedAt,
  };
}

/**
 * A non-empty tuple, for `db.batch()`.
 *
 * Drizzle types batch as `[Item, ...Item[]]` so that an empty batch cannot be
 * submitted. A plain array does not satisfy that, and the usual workaround is
 * a cast — which throws away the one guarantee the type was expressing. This
 * checks instead.
 */
export function asBatch<T>(items: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new Error("Refusing to submit an empty D1 batch");
  }
  return [first, ...rest];
}

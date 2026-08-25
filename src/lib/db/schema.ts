import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The D1 schema, as Drizzle sees it.
 *
 * WHAT IS A COLUMN AND WHAT IS JSON, AND WHY.
 *
 * The zod schemas in src/lib/schemas are the domain. This file is a
 * *projection* of them into something a database can index. The rule applied
 * throughout: a value gets its own column when something queries or sorts by
 * it, and stays JSON when it is a value object that is only ever read back
 * whole.
 *
 * So `cases.received_at` is a column (every deadline in the system counts from
 * it) and `cases.patient` is JSON (a Patient is read with its case or not at
 * all, and flattening it would spread one concept across five nullable columns
 * that no query ever mentions). Seriousness flags stay JSON for a sharper
 * reason: they carry character offsets into the narrative, and a schema that
 * invited someone to join on a character offset would eventually get one.
 *
 * The JSON columns are still validated — everything read out of here goes back
 * through its zod schema before the app sees it, so a row written by an older
 * version is rejected rather than rendered.
 *
 * DATES ARE TEXT, AND THAT IS DELIBERATE.
 *
 * ISO-8601 sorts lexicographically, which means `ORDER BY received_at` is the
 * same order `localeCompare` already gives the in-memory implementations. An
 * integer epoch would sort identically and read as a number nobody can debug.
 */

/**
 * Money-shot table. One row per report that reached us.
 *
 * The four validity criteria are NOT enforced here, for the same reason the
 * zod schema does not enforce them: an incomplete case is a real, storable
 * thing that still needs triaging, and `caseValidity()` reports on it.
 */
export const cases = sqliteTable(
  "cases",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    origin: text("origin").notNull(),
    /** Day 0. Every expedited deadline counts from here. */
    receivedAt: text("received_at").notNull(),
    /** Patient | null, as JSON. */
    patient: text("patient"),
    /** ReporterInfo | null, as JSON. */
    reporter: text("reporter"),
    narrative: text("narrative").notNull().default(""),
    status: text("status").notNull(),
    assignedTo: text("assigned_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The queue reads in receipt order and the cron sweep reads open cases.
    index("cases_received_at_idx").on(table.receivedAt),
    index("cases_status_idx").on(table.status),
  ],
);

export const drugs = sqliteTable(
  "drugs",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    /** Position in the reported list. Order is information: the first-named
     * drug is usually the one the reporter blames. */
    ordinal: integer("ordinal").notNull(),
    reportedName: text("reported_name").notNull(),
    activeSubstance: text("active_substance"),
    /** Criterion three is about a SUSPECT drug specifically, so this is
     * queryable rather than buried in JSON. */
    role: text("role").notNull(),
    marketingStatus: text("marketing_status").notNull(),
    dose: text("dose"),
    route: text("route"),
    indication: text("indication"),
    /** PartialDate | null. JSON because the precision travels with the value
     * and splitting them is how the two stop agreeing. */
    therapyStart: text("therapy_start"),
    therapyEnd: text("therapy_end"),
    dechallenge: text("dechallenge"),
    rechallenge: text("rechallenge"),
  },
  (table) => [
    index("drugs_case_idx").on(table.caseId),
    index("drugs_substance_idx").on(table.activeSubstance),
  ],
);

export const reactions = sqliteTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    verbatimTerm: text("verbatim_term").notNull(),
    meddraPreferredTerm: text("meddra_preferred_term"),
    onset: text("onset"),
    outcome: text("outcome").notNull(),
    /** SeriousnessFlags as JSON — six nullable assertions, each carrying the
     * character span in the narrative that raised it. */
    seriousness: text("seriousness").notNull(),
    /**
     * Derived from `seriousness` on write, by the same function the UI uses.
     *
     * A derived column can drift, so be clear about the contract: the JSON is
     * authoritative and this is an index. It exists because Cluster F's nightly
     * sweep asks "which open cases are serious?" and doing that by loading
     * every case and parsing every flag is a table scan wearing a disguise.
     */
    serious: integer("serious", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("reactions_case_idx").on(table.caseId),
    index("reactions_serious_idx").on(table.serious),
  ],
);

/**
 * Assessment is per reaction-drug pair, not per case — the same reaction
 * against two drugs is two questions with two answers.
 */
export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    reactionId: text("reaction_id").notNull(),
    drugId: text("drug_id").notNull(),
    /** ListednessFinding — a discriminated union over grounded / no_result /
     * source_unavailable, with citations. JSON, because a citation is a chunk
     * id plus a quoted span and there is nothing to query inside it. */
    listedness: text("listedness").notNull(),
    expectedness: text("expectedness").notNull(),
    /** ReviewerRuling | null. The Durable Object is the authority for this;
     * the copy here is what the queue reads. */
    ruling: text("ruling"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("assessments_case_idx").on(table.caseId)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    /** `company` or `public`. The confidentiality boundary, and therefore the
     * one column that must never be wrong. */
    sourceType: text("source_type").notNull(),
    activeSubstance: text("active_substance").notNull(),
    version: text("version"),
    effectiveDate: text("effective_date"),
    /** R2 object key. The Worker stores the key and never the bytes. */
    objectKey: text("object_key"),
    status: text("status").notNull(),
    rejectionReason: text("rejection_reason"),
    chunkCount: integer("chunk_count").notNull().default(0),
    uploadedAt: text("uploaded_at").notNull(),
  },
  (table) => [
    index("documents_source_type_idx").on(table.sourceType),
    index("documents_substance_idx").on(table.activeSubstance),
    index("documents_uploaded_idx").on(table.uploadedAt),
  ],
);

/**
 * Chunk text mirrored into D1, exactly as CLAUDE.md's pipeline step 7 asks:
 * "so a citation can be rendered without a second vector call, and so lexical
 * search works."
 *
 * Both halves of that sentence are load-bearing. The first means a reviewer
 * looking at a citation gets the quoted span from here, not from Vectorize.
 * The second is the FTS5 index below — Vectorize is dense-only, and the hybrid
 * retrieval CLAUDE.md specifies needs a lexical half to fuse with.
 */
export const chunks = sqliteTable(
  "chunks",
  {
    /** `${documentId}#${ordinal}` — deterministic, so re-ingesting a document
     * overwrites its chunks instead of duplicating them. */
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    section: text("section"),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    /** Set once the vector is in Vectorize. Lets the pipeline find work that
     * was chunked but never embedded, rather than assuming success. */
    embeddedAt: text("embedded_at"),
  },
  (table) => [
    index("chunks_document_idx").on(table.documentId),
    // Retrieval always filters by namespace first; a company chunk must never
    // be a candidate for a public query.
    index("chunks_source_type_idx").on(table.sourceType),
    index("chunks_embedded_idx").on(table.embeddedAt),
  ],
);

/**
 * Cluster F's sink. Same five fields the console line has always carried, so
 * nothing about the audit contract changes when the destination does.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    outcome: text("outcome").notNull(),
    /** Free-form detail, as JSON. Never personal data — the same rule the
     * console sink has always stated. */
    detail: text("detail"),
    at: text("at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    index("audit_at_idx").on(table.at),
    index("audit_target_idx").on(table.target),
    index("audit_action_idx").on(table.action),
  ],
);

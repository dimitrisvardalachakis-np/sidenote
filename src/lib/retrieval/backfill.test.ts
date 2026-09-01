/**
 * The backfill, which is a test only so that it can import `@/`.
 *
 * Same reasoning and the same gate as `embed-seed.test.ts`: there is no `tsx`
 * in this project, a plain `.mjs` cannot resolve the alias or the server-only
 * store modules, and vitest already resolves both exactly as the app does.
 *
 *   npm run embed:backfill
 *
 * WHY THIS HAS TO EXIST AT ALL
 *
 * Embedding now happens on upload. Every document uploaded BEFORE that landed
 * sits at `"chunking"` with no vectors, and nothing would ever revisit it — so
 * it would be lexically searchable and permanently invisible to the semantic
 * half, with no error anywhere to say so. That is the same class of silent
 * failure the whole feature was built to remove, reintroduced at the seam.
 *
 * Idempotent: a document already at `"embedded"` is skipped, so running it
 * twice costs nothing. Re-embedding one is a matter of nothing more than
 * setting its status back.
 */
import { describe, expect, it } from "vitest";
import { resolveAiBinding } from "@/lib/assess/ai";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { SafetyDocument, type DocumentChunk } from "@/lib/schemas";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { embedAndUpsert } from "./ingest";
import { resolveDenseFor } from "./resolve";

const ENABLED = process.env["SIDENOTE_EMBED_BACKFILL"] === "1";

describe.runIf(ENABLED)("backfilling vectors for already-uploaded documents", () => {
  it("embeds every document that is chunked but not embedded", async () => {
    const env = { ...process.env };
    const ai = resolveAiBinding(env);
    if (ai.binding === null) {
      throw new Error(
        `no model is configured, so nothing can be embedded — ${ai.reason ?? "unknown reason"}`,
      );
    }

    const dense = resolveDenseFor(env, ai);
    if (dense.store === null || dense.embedder === null) {
      throw new Error(
        `no vector store is available — ${dense.reason ?? "unknown reason"}`,
      );
    }

    const library = await getDocumentLibrary();
    const documents = await library.list();
    /*
      `chunkCount > 0` as well as the status, because a document with no chunks
      has nothing to embed and is not a backfill failure. `embedAndUpsert`
      correctly answers "skipped — the document produced no chunks", and the
      assertion at the bottom would then read that as work this script failed
      to do. Counting it as pending makes the run red for a document that is
      simply empty.
    */
    const pending = documents.filter(
      (d) => d.status === "chunking" && d.chunkCount > 0,
    );

    const results: string[] = [];

    /*
      THE SEEDED FIXTURES, WHICH THIS COULD NOT REACH AND HAD TO.

      Four of the six documents in the library said "Keyword search only — not
      embedded", and running this changed nothing, correctly: the loop below
      walks `library.list()`, and the seeded documents are code fixtures in
      `lib/fixtures/documents.ts` that were never rows in the library at all.
      Their vectors reached exactly one place — `local-vectors.ts` reads
      `seedVectorRecords` directly — so on a deployment with Vectorize
      configured they were keyword-only BY CONSTRUCTION, with nothing anywhere
      saying so, and a semantic query worked on one product out of three.

      They go through the SAME `embedAndUpsert` an upload does. No second
      implementation of chunking, embedding or upserting, and the same rule
      about the word "embedded": it is written only downstream of an upsert
      that actually resolved.

      Saving the record is what makes the screen honest. `status` on a fixture
      is a literal — it cannot know whether an index it was never told about
      holds its vectors — so the backfill stores a record whose status it has
      just earned, and `loadCorpus` prefers a stored record over the fixture
      for exactly this field.
    */
    const seededChunks = new Map<string, DocumentChunk[]>();
    for (const chunk of SEED_CHUNKS) {
      const bucket = seededChunks.get(chunk.documentId);
      if (bucket === undefined) seededChunks.set(chunk.documentId, [chunk]);
      else bucket.push(chunk);
    }

    for (const document of SEED_DOCUMENTS) {
      const already = documents.find((d) => d.id === document.id);
      if (already?.status === "embedded") continue;

      const chunks = seededChunks.get(document.id) ?? [];
      const outcome = await embedAndUpsert({ dense, document, chunks });

      if (outcome.status === "embedded") {
        await library.save({
          document: SafetyDocument.parse({ ...document, status: "embedded" }),
          chunks,
        });
      }

      results.push(
        `${document.title}: ${outcome.status}${
          outcome.status === "embedded"
            ? ` (${outcome.vectors} vectors)`
            : ` — ${outcome.reason}`
        }`,
      );
    }
    for (const record of pending) {
      const entry = await library.get(record.id);
      if (entry === null) continue;

      const outcome = await embedAndUpsert({
        dense,
        document: entry.document,
        chunks: entry.chunks,
      });

      if (outcome.status === "embedded") {
        // The mirror is rewritten with the corrected status only after the
        // upsert resolved, exactly as the upload path does it. There is one
        // rule about "embedded" and it does not get a second implementation.
        await library.save({
          document: SafetyDocument.parse({ ...entry.document, status: "embedded" }),
          chunks: entry.chunks,
        });
      }

      results.push(
        `${record.title}: ${outcome.status}${
          outcome.status === "embedded"
            ? ` (${outcome.vectors} vectors)`
            : ` — ${outcome.reason}`
        }`,
      );
    }

    /*
      A real assertion, not a smoke test.

      A backfill that quietly embedded nothing looks identical to one that had
      nothing to do, and the whole point of this script is that silence about
      an unindexed document is the failure. So every pending document must have
      come back "embedded"; anything else fails the run and prints why.
    */
    const failures = results.filter((line) => !line.includes(": embedded"));
    expect(failures, failures.join("\n")).toEqual([]);
    // Every uploaded document that was pending, plus every seeded one that was
    // not already embedded. A run with nothing to do is legitimate and reports
    // an empty list; a run that SKIPPED something is what the check above
    // catches.
    expect(results.length).toBeGreaterThanOrEqual(pending.length);
  }, 300_000);
});

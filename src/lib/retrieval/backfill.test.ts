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
import { SafetyDocument } from "@/lib/schemas";
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
    const pending = documents.filter((d) => d.status === "chunking");

    const results: string[] = [];
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
    expect(results).toHaveLength(pending.length);
  }, 300_000);
});

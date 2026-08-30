import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentId, SafetyDocument } from "@/lib/schemas";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { getDocumentStore, objectKeyFor } from "@/lib/store/document-store";
import { runStep } from "./steps";

/**
 * The chunk step, run for real.
 *
 * WHY THIS FILE EXISTS. The assess step was verified end to end on workerd and
 * this one never was, and it was broken: it wrote `status: "chunked"`, which is
 * not a value IngestionStatus has. SafetyDocument.parse threw, the message went
 * round the retry loop three times and into the dead-letter queue, and EVERY
 * uploaded document failed to ingest. Nothing in lint, typecheck or the build
 * catches a string literal that is wrong only against a zod enum.
 *
 * So the step is exercised against real stores rather than mocked ones. The
 * runtime is stubbed as Workers so the ephemeral in-memory implementations are
 * selected — a test that wrote to `.data` would leave files in the working tree,
 * which is how a suite starts getting skipped.
 */

function pretendToBeWorkers(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

function resetEphemeralStores(): void {
  delete (globalThis as unknown as { __sidenoteEphemeralStores?: unknown })
    .__sidenoteEphemeralStores;
}

/** Ephemeral writes emit audit lines; keep the suite output readable. */
function silenceAudit(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
}

const DOCUMENT_ID = DocumentId.parse("55555555-5555-4555-8555-555555555555");

const CCDS_TEXT = `4 CLINICAL PARTICULARS

4.8 Undesirable effects

Erythema and urticaria have been reported in clinical trials. Cutaneous
reactions including Stevens-Johnson syndrome have been observed rarely.

4.9 Overdose

No case of overdose has been reported to date.
`;

async function seedDocument(): Promise<string> {
  const library = await await getDocumentLibrary();
  const store = await getDocumentStore();

  const objectKey = objectKeyFor("company", DOCUMENT_ID, "ccds.pdf");
  const textKey = `${objectKey}.txt`;

  await store.put(textKey, new TextEncoder().encode(CCDS_TEXT), {
    contentType: "text/plain; charset=utf-8",
    filename: "ccds.pdf.txt",
  });

  // Exactly what the upload action writes before enqueuing: the record, no
  // chunks, and a status naming the stage it is in.
  await library.save({
    document: SafetyDocument.parse({
      id: DOCUMENT_ID,
      title: "Covaxil CCDS v7.2",
      kind: "ccds",
      sourceType: "company",
      activeSubstance: "covaxil",
      version: "7.2",
      effectiveDate: "2026-01-15",
      objectKey,
      status: "chunking",
      rejectionReason: null,
      chunkCount: 0,
      uploadedAt: "2026-08-25T09:00:00.000Z",
    }),
    chunks: [],
  });

  return textKey;
}

beforeEach(() => {
  resetEphemeralStores();
  pretendToBeWorkers();
  silenceAudit();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chunk_document", () => {
  it("chunks the text and mirrors the chunks into the library", async () => {
    const textKey = await seedDocument();

    await runStep({
      kind: "chunk_document",
      documentId: DOCUMENT_ID,
      textKey,
    });

    const entry = await (await getDocumentLibrary()).get(DOCUMENT_ID);
    expect(entry).not.toBeNull();
    expect(entry?.chunks.length).toBeGreaterThan(0);
    expect(entry?.document.chunkCount).toBe(entry?.chunks.length);

    // The section path survives, because that is what a citation shows.
    expect(entry?.chunks.some((c) => c.section?.includes("4.8"))).toBe(true);
  });

  it("writes a status the schema actually has", async () => {
    const textKey = await seedDocument();

    // The regression. `"chunked"` reads perfectly well in English and is not a
    // value IngestionStatus contains, and the only thing that notices is a zod
    // parse at runtime inside a queue consumer nobody is watching.
    await expect(
      runStep({ kind: "chunk_document", documentId: DOCUMENT_ID, textKey }),
    ).resolves.toBeDefined();

    const entry = await (await getDocumentLibrary()).get(DOCUMENT_ID);
    expect(entry?.document.status).toBe("chunking");
  });

  it("asks for the chunks to be embedded next", async () => {
    const textKey = await seedDocument();

    const followUps = await runStep({
      kind: "chunk_document",
      documentId: DOCUMENT_ID,
      textKey,
    });

    // Chunking and embedding are separate messages so they retry
    // independently — the chain has to actually continue.
    expect(followUps).toEqual([
      { kind: "embed_document", documentId: DOCUMENT_ID },
    ]);
  });

  it("rejects a document whose text chunks to nothing, and stops the chain", async () => {
    const library = await await getDocumentLibrary();
    const store = await getDocumentStore();
    const objectKey = objectKeyFor("company", DOCUMENT_ID, "scan.pdf");
    const textKey = `${objectKey}.txt`;

    await store.put(textKey, new TextEncoder().encode("   \n  \n"), {
      contentType: "text/plain",
      filename: "scan.pdf.txt",
    });
    await library.save({
      document: SafetyDocument.parse({
        id: DOCUMENT_ID,
        title: "A scan",
        kind: "ccds",
        sourceType: "company",
        activeSubstance: "covaxil",
        version: null,
        effectiveDate: null,
        objectKey,
        status: "chunking",
        rejectionReason: null,
        chunkCount: 0,
        uploadedAt: "2026-08-25T09:00:00.000Z",
      }),
      chunks: [],
    });

    const followUps = await runStep({
      kind: "chunk_document",
      documentId: DOCUMENT_ID,
      textKey,
    });

    // Zero chunks looks exactly like a document that mentions nothing, which a
    // reviewer would read as "not listed". It is rejected instead, and nothing
    // is queued for embedding.
    const entry = await library.get(DOCUMENT_ID);
    expect(entry?.document.status).toBe("rejected");
    expect(entry?.document.rejectionReason).toBe("empty_document");
    expect(followUps).toEqual([]);
  });

  it("does not retry forever for a document that no longer exists", async () => {
    // Acked with an audit line rather than thrown. Retrying three times and
    // then filling the dead-letter queue with the hopeless teaches whoever
    // reads the DLQ to ignore it.
    await expect(
      runStep({
        kind: "chunk_document",
        documentId: DocumentId.parse("99999999-9999-4999-8999-999999999999"),
        textKey: "company/99999999-9999-4999-8999-999999999999.pdf.txt",
      }),
    ).resolves.toEqual([]);
  });

  it("retries when the text is missing but the document is not", async () => {
    const library = await await getDocumentLibrary();
    await library.save({
      document: SafetyDocument.parse({
        id: DOCUMENT_ID,
        title: "Covaxil CCDS",
        kind: "ccds",
        sourceType: "company",
        activeSubstance: "covaxil",
        version: null,
        effectiveDate: null,
        objectKey: "company/x.pdf",
        status: "chunking",
        rejectionReason: null,
        chunkCount: 0,
        uploadedAt: "2026-08-25T09:00:00.000Z",
      }),
      chunks: [],
    });

    // The opposite case to the one above: the record is there and the bytes
    // are not, which is a write that may still land. Throwing is what asks the
    // platform to redeliver.
    await expect(
      runStep({
        kind: "chunk_document",
        documentId: DOCUMENT_ID,
        textKey: "company/never-written.txt",
      }),
    ).rejects.toThrow(/not in the object store/);
  });
});

describe("IngestionStatus, as the pipeline uses it", () => {
  it("has the two values the pipeline writes, and not the one it wrote by mistake", () => {
    const base = {
      id: DOCUMENT_ID,
      title: "x",
      kind: "ccds",
      sourceType: "company",
      activeSubstance: "covaxil",
      version: null,
      effectiveDate: null,
      objectKey: null,
      rejectionReason: null,
      chunkCount: 0,
      uploadedAt: "2026-08-25T09:00:00.000Z",
    };

    expect(SafetyDocument.safeParse({ ...base, status: "chunking" }).success).toBe(true);
    expect(SafetyDocument.safeParse({ ...base, status: "embedded" }).success).toBe(true);
    expect(SafetyDocument.safeParse({ ...base, status: "chunked" }).success).toBe(false);
  });
});

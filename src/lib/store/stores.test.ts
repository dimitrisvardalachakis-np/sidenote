import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Case } from "@/lib/schemas";
import { getCaseStore } from "./case-store";
import type { LibraryEntry } from "./library-store";
import { getDocumentLibrary } from "./library-store";
import {
  UnsafeObjectKeyError,
  getDocumentStore,
  objectKeyFor,
} from "./document-store";

/**
 * The three stores, on the runtime Cluster C added.
 *
 * The contract worth proving is that the ephemeral implementations are the
 * SAME SHAPE as the disk ones — same ordering, same null-on-missing, same key
 * validation — because Cluster D is going to replace both with a third pair,
 * and every difference between them now is a bug waiting to be introduced
 * then. Anything that only holds on one runtime is not a contract.
 *
 * Only the Workers side is exercised here. The local side writes to `.data`,
 * and a test suite that leaves files behind in the developer's working tree is
 * a test suite people start skipping.
 */

function pretendToBeWorkers(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

/**
 * The ephemeral stores are anchored to globalThis on purpose, so that a page
 * and a route handler in different bundles share one instance (see
 * backing.ts). The same anchoring makes them outlive a test file, so each test
 * clears the registry rather than trusting module scope to be fresh.
 */
function resetEphemeralStores(): void {
  delete (globalThis as unknown as { __sidenoteEphemeralStores?: unknown })
    .__sidenoteEphemeralStores;
}

beforeEach(resetEphemeralStores);

/** Silences the ephemeral-write audit lines, and lets them be asserted. */
function captureAudit(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return lines;
}

const NOW = "2026-08-25T09:00:00.000Z";

/**
 * Built through the schema, not hand-rolled.
 *
 * Case's ids are branded and half its fields are required, so a literal shaped
 * "close enough" does not compile — which is the point. A fixture that is not
 * a real Case proves nothing about a store that holds real Cases.
 */
function caseRecord(id: string, reference: string, createdAt: string): Case {
  return Case.parse({
    id,
    reference,
    origin: "public_form",
    receivedAt: createdAt.slice(0, 10),
    patient: null,
    reporter: null,
    drugs: [],
    reactions: [],
    narrative: "",
    status: "received",
    assignedTo: null,
    createdAt,
    updatedAt: createdAt,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EphemeralCaseStore", () => {
  it("round-trips a case and announces that the write is temporary", async () => {
    pretendToBeWorkers();
    const lines = captureAudit();
    const store = getCaseStore();

    const id = "11111111-1111-4111-8111-111111111111";
    const record = caseRecord(id, "SN-2026-500001", NOW);
    await store.put(record);

    expect(await store.get(id)).toEqual(record);

    const audit = lines
      .filter((line) => line.startsWith("[AUDIT]"))
      .map((line) => JSON.parse(line.slice("[AUDIT] ".length)) as unknown);
    // A reference number is a promise of durability. If this line is not
    // emitted, nothing anywhere records that the promise was not kept.
    expect(audit).toContainEqual(
      expect.objectContaining({
        action: "ephemeral_write",
        target: "case_store:SN-2026-500001",
      }),
    );
  });

  it("returns null for an id that is not a uuid, without looking", async () => {
    pretendToBeWorkers();
    captureAudit();
    const store = getCaseStore();
    // Same refusal as the disk implementation, where it stops a caller
    // building a filename out of "../../etc/passwd".
    expect(await store.get("../../etc/passwd")).toBeNull();
    expect(await store.get("not-a-uuid")).toBeNull();
  });

  it("lists newest first, like the disk store", async () => {
    pretendToBeWorkers();
    captureAudit();
    const store = getCaseStore();

    await store.put(
      caseRecord(
        "22222222-2222-4222-8222-222222222222",
        "SN-2026-500002",
        "2026-08-01T00:00:00.000Z",
      ),
    );
    await store.put(
      caseRecord(
        "33333333-3333-4333-8333-333333333333",
        "SN-2026-500003",
        "2026-08-20T00:00:00.000Z",
      ),
    );

    const listed = await store.list();
    const order = listed.map((record) => String(record.reference));
    expect(order.indexOf("SN-2026-500003")).toBeLessThan(
      order.indexOf("SN-2026-500002"),
    );
  });
});

describe("EphemeralDocumentStore", () => {
  it("round-trips bytes under a namespaced key", async () => {
    pretendToBeWorkers();
    captureAudit();
    const store = getDocumentStore();

    const key = objectKeyFor(
      "company",
      "44444444-4444-4444-8444-444444444444",
      "ccds.pdf",
    );
    expect(key).toBe("company/44444444-4444-4444-8444-444444444444.pdf");

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const stored = await store.put(key, bytes, {
      contentType: "application/pdf",
      filename: "ccds.pdf",
    });

    expect(stored.byteLength).toBe(4);
    expect(await store.get(key)).toEqual(bytes);
  });

  it("copies the bytes rather than keeping the caller's buffer", async () => {
    pretendToBeWorkers();
    captureAudit();
    const store = getDocumentStore();

    const key = "company/55555555-5555-4555-8555-555555555555.pdf";
    const bytes = new Uint8Array([9, 9, 9]);
    await store.put(key, bytes, {
      contentType: "application/pdf",
      filename: "x.pdf",
    });

    // The caller built this from a request body it is free to reuse. A store
    // that keeps a view of someone else's buffer corrupts downloads later, in
    // a way that looks like an R2 problem when R2 arrives.
    bytes[0] = 1;
    expect(await store.get(key)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("refuses an unsafe key on this runtime too", async () => {
    pretendToBeWorkers();
    captureAudit();
    const store = getDocumentStore();

    // A Map cannot be escaped from, so this check is not load-bearing here —
    // which is exactly why it would get dropped, and why it is tested. It has
    // to survive to the runtime where it IS load-bearing.
    await expect(
      store.put("../../etc/passwd", new Uint8Array([0]), {
        contentType: "text/plain",
        filename: "passwd",
      }),
    ).rejects.toThrow(UnsafeObjectKeyError);
    await expect(store.get("company/../../secret")).rejects.toThrow(
      UnsafeObjectKeyError,
    );
  });

  it("filters list() by prefix, as R2 does", async () => {
    pretendToBeWorkers();
    captureAudit();
    const store = getDocumentStore();

    await store.put(
      "company/66666666-6666-4666-8666-666666666666.pdf",
      new Uint8Array([1]),
      { contentType: "application/pdf", filename: "a.pdf" },
    );
    await store.put(
      "public/77777777-7777-4777-8777-777777777777.pdf",
      new Uint8Array([1]),
      { contentType: "application/pdf", filename: "b.pdf" },
    );

    const company = await store.list("company");
    expect(company.every((object) => object.key.startsWith("company/"))).toBe(
      true,
    );
    // The two namespaces are the confidentiality boundary; a prefix filter
    // that leaked across it would put CCDS text in a public result list.
    expect(company.some((object) => object.key.startsWith("public/"))).toBe(
      false,
    );
  });
});

describe("EphemeralDocumentLibrary", () => {
  it("refuses a document id that is not a uuid", async () => {
    pretendToBeWorkers();
    captureAudit();
    const library = getDocumentLibrary();

    // Deliberately malformed. The disk implementation would turn this straight
    // into a filename, so the guard has to hold on both runtimes — and proving
    // that needs a value the type system would otherwise refuse to build.
    const malformed = {
      document: { id: "not-a-uuid" },
      chunks: [],
    } as unknown as LibraryEntry;

    await expect(library.save(malformed)).rejects.toThrow(/not a uuid/);
    expect(await library.get("not-a-uuid")).toBeNull();
  });
});

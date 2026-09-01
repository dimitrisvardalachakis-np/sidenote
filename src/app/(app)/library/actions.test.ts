import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving the same document twice, through the Server Action.
 *
 * `duplicates.test.ts` pins what counts as a duplicate. This pins that the
 * upload path ASKS — which is the half that was missing. `saveDocument` minted
 * a fresh `crypto.randomUUID()` per save and checked nothing, so the live
 * library ended up holding two rows titled "Cardiquel Company Core Data Sheet
 * v4.2", two R2 objects and 38 vectors where there should have been 31. Every
 * unit test passed throughout; nothing below the action had been asked.
 *
 * So this goes through the action and reads back out of the store the library
 * screen lists from, and it asserts the R2 side too — a refusal that still
 * wrote the bytes would leave an object no row references.
 */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { startSession } = await import("@/lib/auth");
const { saveDocument } = await import("./actions");
const { INITIAL_UPLOAD_STATE } = await import("./upload-state");
const { getDocumentLibrary } = await import("@/lib/store/library-store");
const { getDocumentStore } = await import("@/lib/store/document-store");

/** Long enough, and prose enough, to survive `assessExtraction`. */
const CCDS_TEXT = `4 CLINICAL PARTICULARS

4.8 Undesirable effects

Elevations in hepatic transaminases have been reported in approximately 2.1% of
patients receiving cardiquelin. Jaundice has been reported rarely and generally
resolved on discontinuation of therapy. Hypersensitivity reactions including
urticaria have been observed in clinical trials.

4.9 Overdose

No case of overdose has been reported to date.
`;

function upload(over: { text?: string; version?: string; confirm?: boolean } = {}): FormData {
  const form = new FormData();
  form.set("title", "Cardiquel Company Core Data Sheet v4.2");
  form.set("kind", "ccds");
  form.set("activeSubstance", "cardiquelin");
  form.set("version", over.version ?? "v4.2");
  form.set("effectiveDate", "2026-01-04");
  form.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], "cardiquel-ccds-v4.2.pdf", {
      type: "application/pdf",
    }),
  );
  form.set("extractedText", over.text ?? CCDS_TEXT);
  form.set("pageCount", "3");
  if (over.confirm === true) form.set("confirmSupersedes", "on");
  return form;
}

const save = (form: FormData) => saveDocument(INITIAL_UPLOAD_STATE, form);

beforeEach(async () => {
  jar.clear();
  // Ephemeral stores, so the suite does not write into .data and leak a
  // library between runs — the same reason schedule.test.ts does this.
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  delete (globalThis as unknown as { __sidenoteEphemeralStores?: unknown })
    .__sidenoteEphemeralStores;
  vi.spyOn(console, "log").mockImplementation(() => {});
  await startSession("reviewer-demo");
});

describe("the same file, saved twice", () => {
  it("stores it once and names what is already held", async () => {
    const first = await save(upload());
    expect(first.status).toBe("saved");

    const second = await save(upload());

    expect(second.status).toBe("duplicate");
    expect(second.duplicate?.kind).toBe("same_content");
    // Named, not merely flagged. The reviewer must not have to go looking.
    expect(second.duplicate?.message).toContain(
      "Cardiquel Company Core Data Sheet v4.2",
    );

    // THE ASSERTION THE OLD CODE FAILED. Two rows here is what produced
    // "Searched ... v4.2, ... v4.2" and one passage offered twice.
    const held = await (await getDocumentLibrary()).list();
    expect(held).toHaveLength(1);
  });

  it("writes no R2 object for the upload it refused", async () => {
    await save(upload());
    const afterFirst = await (await getDocumentStore()).list();
    await save(upload());
    const afterSecond = await (await getDocumentStore()).list();

    // A refusal after the put would leave bytes nothing references, and tell
    // the reviewer nothing was saved while something was.
    expect(afterSecond.length).toBe(afterFirst.length);
  });
});

describe("a different extraction of the same version", () => {
  it("is refused once, then accepted on an explicit acknowledgement", async () => {
    await save(upload());

    const corrected = upload({ text: `${CCDS_TEXT}\n4.10 Effects on driving\n\nNo studies have been performed.\n` });
    const warned = await save(corrected);
    expect(warned.status).toBe("duplicate");
    expect(warned.duplicate?.kind).toBe("same_version");

    const confirmed = await save(
      upload({
        text: `${CCDS_TEXT}\n4.10 Effects on driving\n\nNo studies have been performed.\n`,
        confirm: true,
      }),
    );
    expect(confirmed.status).toBe("saved");
    expect(await (await getDocumentLibrary()).list()).toHaveLength(2);
  });

  /*
    The acknowledgement does not excuse identical text.

    There is no version of "I have read what is held" that makes a
    byte-identical second copy worth storing, so the box must not be a way
    round the content check.
  */
  it("still refuses identical text even when the box is ticked", async () => {
    await save(upload());
    const again = await save(upload({ confirm: true }));
    expect(again.status).toBe("duplicate");
    expect(again.duplicate?.kind).toBe("same_content");
    expect(await (await getDocumentLibrary()).list()).toHaveLength(1);
  });
});

describe("a genuinely new document is unaffected", () => {
  it("saves a later version alongside the one held", async () => {
    await save(upload());
    const next = await save(
      upload({ version: "v5.0", text: CCDS_TEXT.replace("2.1%", "3.4%") }),
    );
    expect(next.status).toBe("saved");
    expect(await (await getDocumentLibrary()).list()).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import { SafetyDocument } from "@/lib/schemas";
import { duplicateMessage, findDuplicate } from "./duplicates";

/**
 * What counts as already held, and what a reviewer is told about it.
 *
 * The bug this closes was silent by construction: two documents, two R2
 * objects and two vector sets, and a verdict that came out the same either
 * way. What changed was the evidence panel — "Searched Cardiquel Company Core
 * Data Sheet v4.2, Cardiquel Company Core Data Sheet v4.2", and one passage
 * offered twice from two ids. Nothing failed. The reviewer was simply shown
 * corroboration that did not exist.
 */

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function doc(over: Partial<SafetyDocument> = {}): SafetyDocument {
  return SafetyDocument.parse({
    id: "00000001-0000-4000-8000-000000000001",
    title: "Cardiquel Company Core Data Sheet v4.2",
    kind: "ccds",
    sourceType: "company",
    activeSubstance: "cardiquelin",
    version: "v4.2",
    effectiveDate: "2026-01-04",
    objectKey: "company/doc.pdf",
    status: "embedded",
    rejectionReason: null,
    chunkCount: 31,
    uploadedAt: "2026-08-31T13:30:00Z",
    contentHash: HASH_A,
    ...over,
  });
}

const CANDIDATE = {
  contentHash: HASH_A,
  activeSubstance: "cardiquelin",
  kind: "ccds" as const,
  version: "v4.2",
};

describe("the same text is refused outright", () => {
  it("recognises byte-identical content", () => {
    const found = findDuplicate([doc()], CANDIDATE);
    expect(found?.kind).toBe("same_content");
  });

  /*
    The stronger fact wins, and the order is the policy.

    Re-uploading the identical file under a corrected substance name is still
    the same document. Reporting it as a version clash would offer a confirm
    box for storing a byte-identical second copy, which there is no reason to
    ever want.
  */
  it("reports identical content even when the metadata was retyped", () => {
    const found = findDuplicate([doc()], {
      ...CANDIDATE,
      activeSubstance: "Cardiquel (cardiquelin)",
      version: "4.2",
    });
    expect(found?.kind).toBe("same_content");
  });

  it("holds nothing against a document whose text differs", () => {
    expect(
      findDuplicate([doc()], {
        ...CANDIDATE,
        contentHash: HASH_B,
        version: "v5.0",
      }),
    ).toBeNull();
  });
});

describe("the natural key warns rather than refuses forever", () => {
  it("matches on substance, kind and version with different text", () => {
    const found = findDuplicate([doc()], { ...CANDIDATE, contentHash: HASH_B });
    expect(found?.kind).toBe("same_version");
  });

  it("compares the way people type, not the way strings compare", () => {
    const found = findDuplicate([doc({ activeSubstance: "Cardiquelin", version: "V4.2 " })], {
      ...CANDIDATE,
      contentHash: HASH_B,
    });
    expect(found?.kind).toBe("same_version");
  });

  it("does not fire across kinds", () => {
    // A CCDS and an Investigator's Brochure for one substance are two
    // different documents that legitimately share a version string.
    expect(
      findDuplicate([doc()], {
        ...CANDIDATE,
        contentHash: HASH_B,
        kind: "investigators_brochure",
      }),
    ).toBeNull();
  });

  /*
    Two unversioned documents are not the same document.

    Firing on null == null would block the second of two genuinely different
    uploads, and "you already hold an unversioned CCDS for cardiquelin" is not
    a warning anybody can act on.
  */
  it("never matches two documents that name no version", () => {
    expect(
      findDuplicate([doc({ version: null })], {
        ...CANDIDATE,
        contentHash: HASH_B,
        version: null,
      }),
    ).toBeNull();
  });
});

describe("what is skipped", () => {
  it("ignores a rejected document entirely", () => {
    // A scanned PDF has no usable text, so it is not the same as anything and
    // its version says nothing about what the library holds.
    const rejected = doc({
      status: "rejected",
      rejectionReason: "no_text_layer",
      contentHash: null,
      chunkCount: 0,
    });
    expect(findDuplicate([rejected], { ...CANDIDATE, contentHash: HASH_B })).toBeNull();
  });

  /*
    Null is "not known", and it must not collide with itself.

    Every document stored before `contentHash` existed has null here. A ""
    default would have claimed they all share the hash of the empty string,
    and the first upload after the migration would have been refused as a
    duplicate of a document it has nothing in common with.
  */
  it("does not treat two unknown hashes as the same content", () => {
    const legacy = doc({ contentHash: null, version: "v1.0" });
    expect(findDuplicate([legacy], { ...CANDIDATE, contentHash: null, version: "v9" })).toBeNull();
  });
});

describe("the message names what is held", () => {
  it("says which document, when, and how big", () => {
    const found = findDuplicate([doc()], CANDIDATE);
    expect(found).not.toBeNull();
    if (found === null) return;
    const message = duplicateMessage(found);
    expect(message).toContain("Cardiquel Company Core Data Sheet v4.2");
    expect(message).toContain("2026-08-31");
    expect(message).toContain("31 passages");
    // "Duplicate" alone asks somebody to go and find out what they collided
    // with. Naming it is the whole requirement.
    expect(message).not.toMatch(/^duplicate/i);
  });

  it("offers the way past only on the version clash", () => {
    const version = findDuplicate([doc()], { ...CANDIDATE, contentHash: HASH_B });
    const content = findDuplicate([doc()], CANDIDATE);
    expect(version).not.toBeNull();
    expect(content).not.toBeNull();
    if (version === null || content === null) return;
    expect(duplicateMessage(version)).toContain("Tick the box");
    expect(duplicateMessage(content)).toContain("Nothing was saved");
    expect(duplicateMessage(content)).not.toContain("Tick the box");
  });
});

/**
 * Does the library already hold this document?
 *
 * WHAT WENT WRONG. `saveDocument` minted a fresh `crypto.randomUUID()` for
 * every save and checked nothing, so uploading the same file twice produced two
 * documents, two R2 objects and two sets of vectors. The next assessment then
 * told a reviewer it had "Searched Cardiquel Company Core Data Sheet v4.2,
 * Cardiquel Company Core Data Sheet v4.2" and offered two passages where there
 * was one — the same passage, from two document ids. The ruling was unaffected,
 * which is the part that makes it dangerous rather than merely untidy:
 * duplicated evidence reads as corroboration, and an evidence panel that can
 * manufacture corroboration is not one a reviewer can weigh.
 *
 * TWO QUESTIONS, NOT ONE, AND THEY DESERVE DIFFERENT ANSWERS.
 *
 * "Is this the same bytes of text?" is a question with a right answer, and the
 * answer is a refusal. Nobody ever means to store the same document twice, and
 * there is nothing a second copy could be for.
 *
 * "Is this another CCDS v4.2 for hepalexin?" is a question with no right
 * answer. Usually it is a mistake. Sometimes it is a corrected extraction of a
 * document whose printed version did not change, which is a real thing that
 * happens and which the reviewer, not this function, is qualified to judge. So
 * it refuses ONCE, names what is already held, and takes an explicit
 * acknowledgement — the reviewer sees what they are about to duplicate before
 * they duplicate it, and nothing lands by accident.
 *
 * Pure, over the records it is handed. The store lookup and the audit line stay
 * in the action; what counts as a duplicate is decidable from the values alone
 * and is tested that way.
 */
import type { DocumentKind, SafetyDocument } from "@/lib/schemas";
import { formatDate } from "@/lib/format/datetime";

export type DuplicateFinding =
  /** Byte-identical extracted text. Refused outright. */
  | { readonly kind: "same_content"; readonly held: SafetyDocument }
  /** Same substance, kind and version; different text. Refused once. */
  | { readonly kind: "same_version"; readonly held: SafetyDocument };

export interface DuplicateCandidate {
  /** Null when the text could not be extracted, which is never a duplicate. */
  readonly contentHash: string | null;
  readonly activeSubstance: string;
  readonly kind: DocumentKind;
  readonly version: string | null;
}

/** Substance and version are typed by people; compare them the way people mean. */
function sameLabel(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The first thing this upload collides with, or null.
 *
 * ORDER IS THE POLICY. Content identity is checked across the whole library
 * before any version match is considered, so re-uploading an identical file
 * under a corrected substance name is still reported as the same content
 * rather than as a new document that merely shares a version string. The
 * stronger fact wins, and it is the one whose message is most useful.
 *
 * A rejected document is never a match. It has no usable text, so its
 * `contentHash` is null and its version says nothing about what we hold.
 */
export function findDuplicate(
  held: readonly SafetyDocument[],
  candidate: DuplicateCandidate,
): DuplicateFinding | null {
  const usable = held.filter((doc) => doc.status !== "rejected");

  if (candidate.contentHash !== null) {
    const identical = usable.find(
      (doc) => doc.contentHash === candidate.contentHash,
    );
    if (identical !== undefined) {
      return { kind: "same_content", held: identical };
    }
  }

  const sameVersion = usable.find(
    (doc) =>
      doc.kind === candidate.kind &&
      sameLabel(doc.activeSubstance, candidate.activeSubstance) &&
      // Both must NAME a version. "You already hold an unversioned CCDS for
      // hepalexin" is not the warning this is for, and firing it on two nulls
      // would block the second of two genuinely different documents.
      sameLabel(doc.version, candidate.version),
  );
  if (sameVersion !== undefined) {
    return { kind: "same_version", held: sameVersion };
  }

  return null;
}

/**
 * What the reviewer is told, and it always names what is already held.
 *
 * "Duplicate" on its own asks somebody to go and find out what they collided
 * with. The title, the date and the size of the held document are what turn the
 * message into something they can act on without leaving the screen.
 */
export function duplicateMessage(finding: DuplicateFinding): string {
  const { held } = finding;
  const when = formatDate(held.uploadedAt);
  const size = `${held.chunkCount} passage${held.chunkCount === 1 ? "" : "s"}`;
  const indexed =
    held.status === "embedded" ? "indexed for semantic search" : "keyword search only";

  if (finding.kind === "same_content") {
    return (
      `This is word for word the text already held as “${held.title}”, ` +
      `uploaded ${when} — ${size}, ${indexed}. Nothing was saved.`
    );
  }
  return (
    `You already hold “${held.title}” for this substance and version, ` +
    `uploaded ${when} — ${size}, ${indexed}. The text is different, so this ` +
    `may be a corrected extraction. Tick the box below to store it as a ` +
    `second document, or change the version if this is a newer one.`
  );
}

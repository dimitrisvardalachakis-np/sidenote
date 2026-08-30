/**
 * What the reporter is told about the published information, before they send.
 *
 * THE STATE THIS FILE EXISTS FOR is the one the intake chat used to collapse.
 * `assessAgainstDocuments` ended at `alreadyDescribed: hits.length > 0` — a
 * bare count, with nothing between the ranking and the sentence
 * *"{reaction} does appear in the published information for {drug}"* shown to
 * a member of the public. It was the only surface in the system that asserted
 * what a document says with no model having read the passage, and NOTES.md
 * says so at length under "The surface that should not get the better
 * retriever".
 *
 * So the claim now has a model behind it, and this function is where the
 * model's three states and retrieval's own third state are held apart:
 *
 *   no_label_held   we hold no public label for this medicine. Nothing was
 *                   searched, so nothing may be said about what a label
 *                   contains. This is the state a reporter naming a COVID
 *                   vaccine hit — openFDA's drug label dataset holds none —
 *                   and being told "not in the published information" was an
 *                   assertion about a document nobody opened.
 *   read            a passage was found and quoted, verbatim and verified.
 *   nothing_found   the model read the passages and none is about this.
 *   unreadable      passages were retrieved and no reading could be produced.
 *                   An outage is not a document saying nothing.
 *
 * Pure, and takes the answer rather than fetching it, so every one of those
 * states is reachable in a test without a network.
 */
import type { Citation, GroundedNarrative } from "@/lib/schemas";
import type { SafetyDocument } from "@/lib/schemas";
import type { PublicAnswer } from "@/lib/assess/answer";

export type ReviewOutcome =
  | { readonly kind: "no_label_held" }
  | {
      readonly kind: "read";
      readonly quotedSpan: string;
      readonly chunkId: string;
      /** Null when the model's sentence was discarded and its citation stood. */
      readonly rationale: string | null;
    }
  | { readonly kind: "nothing_found" }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface ReviewInput {
  /**
   * How many PUBLIC documents were in scope for this medicine.
   *
   * Public specifically, not the size of the scope set. `documentsForDrug`
   * filters by product and not by source type, so a scope holding only a
   * company CCDS would be non-empty while no public label exists — and
   * "we searched the label and it is not there" would be said about a label
   * this system does not have. That is the same collapse the third state was
   * added to prevent, one layer up.
   */
  readonly publicDocumentsInScope: number;
  readonly answer: PublicAnswer;
}

export function reviewOutcome(input: ReviewInput): ReviewOutcome {
  if (input.publicDocumentsInScope === 0) return { kind: "no_label_held" };

  const { reading } = input.answer;

  /*
    No reading at all means retrieval returned nothing to read.

    `answerPublicQuestion` returns `reading: null` when the fused ranking is
    empty, which is a fact about the search and not about the model. A label IS
    held — that is the branch above — so this is the honest "we looked and
    found no relevant passage", which is what `nothing_found` means to a
    reporter. It is not `unreadable`: nothing failed.
  */
  if (reading === null) return { kind: "nothing_found" };

  switch (reading.status) {
    case "read":
      return {
        kind: "read",
        quotedSpan: reading.quotedSpan,
        chunkId: reading.chunkId,
        rationale: reading.rationale,
      };
    case "nothing_found":
      return { kind: "nothing_found" };
    case "unavailable":
      return { kind: "unreadable", reason: reading.reason };
  }
}

/**
 * The public documents a scope actually reaches.
 *
 * Separate from `documentsForDrug` because that answers "which documents
 * govern this product" and this answers "which of those may be quoted to an
 * anonymous member of the public" — the confidentiality boundary CLAUDE.md
 * draws, applied before anything is counted rather than after.
 */
export function publicDocumentsInScope(
  documents: readonly SafetyDocument[],
  scope: ReadonlySet<string> | null,
): number {
  return documents.filter(
    (document) =>
      document.sourceType === "public" &&
      (scope === null || scope.has(document.id)),
  ).length;
}

/**
 * Everything the review screen renders, as one serialisable value.
 *
 * Crosses the Server Action boundary, so every field is a plain object from a
 * zod output type. `computedFor` is what stops a model call being spent again
 * when the reporter corrects their own name: the reading is about a reaction
 * and a medicine, and only those two changing can change it.
 */
export interface ChatReview {
  readonly outcome: ReviewOutcome;
  /** The passages retrieved, shown whatever the reading said. */
  readonly citations: readonly Citation[];
  readonly narrative: GroundedNarrative | null;
  /** The medicine named, for the sentences that name it. */
  readonly drug: string;
  readonly computedFor: { readonly drug: string; readonly reaction: string };
}

/** True when a review already in hand still answers the current answers. */
export function reviewIsCurrent(
  review: ChatReview | null,
  slots: { readonly drug: string | null; readonly reaction: string | null },
): boolean {
  if (review === null) return false;
  return (
    review.computedFor.drug === (slots.drug ?? "") &&
    review.computedFor.reaction === (slots.reaction ?? "")
  );
}

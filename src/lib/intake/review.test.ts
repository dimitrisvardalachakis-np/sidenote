/**
 * The four things the intake chat may honestly tell a reporter about a label,
 * and the three ways the old two-state boolean collapsed them.
 *
 * This file replaces the retrieval tests that used to live in
 * `conversation.test.ts`. The rules they held are not lost — they moved to a
 * better-guarded path. `answer.test.ts` already tests the confidentiality
 * boundary ("never surfaces a company chunk, however confidently the store
 * returns it") and the scoping rule ("cites only the named medicine, even when
 * another label matches better") against the very function this path now
 * calls. What is left for this file is the mapping those tests cannot reach:
 * turning an answer into a sentence a member of the public reads.
 */
import { describe, expect, it } from "vitest";
import { SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { ChunkId } from "@/lib/schemas";
import type { PublicAnswer } from "@/lib/assess/answer";
import type { ChatReview } from "./review";
import { publicDocumentsInScope, reviewIsCurrent, reviewOutcome } from "./review";

const NOW = "2026-08-30T12:00:00.000Z";

const answer = (over: Partial<PublicAnswer> = {}): PublicAnswer => ({
  citations: [],
  reading: null,
  hits: [],
  narrative: null,
  ...over,
});

const read: PublicAnswer = answer({
  reading: {
    status: "read",
    chunkId: ChunkId.parse("public#1"),
    quotedSpan: "Headaches/migraine 7% 11%",
    rationale: "The incidence table lists headache.",
    model: "test-model",
    gatewayRequestId: null,
    generatedAt: NOW,
  },
});

describe("no label held is not a finding about the label", () => {
  /*
    A real reporter hit this. They described dizziness after a Moderna COVID
    vaccine; openFDA's drug label dataset holds no vaccines at all, so nothing
    was fetched and nothing was in scope. The chat told them their reaction was
    not in the published information for that medicine — an assertion about a
    document nobody opened.
  */
  it("says the label is not held, not that the reaction is absent from it", () => {
    const outcome = reviewOutcome({
      publicDocumentsInScope: 0,
      answer: answer(),
    });
    expect(outcome.kind).toBe("no_label_held");
  });

  it("holds even when a reading somehow arrives with it", () => {
    // Belt and braces: no public document in scope means nothing may be
    // claimed, whatever else is in hand.
    const outcome = reviewOutcome({ publicDocumentsInScope: 0, answer: read });
    expect(outcome.kind).toBe("no_label_held");
  });

  it("counts public documents only", () => {
    /*
      The scope set is filtered by PRODUCT, not by source type, so a product
      with a company CCDS and no public label produces a non-empty scope. If
      that counted, "we searched the published label" would be said about a
      label this system does not have — the same collapse, one field over.
    */
    const company = SEED_DOCUMENTS.filter((d) => d.sourceType === "company");
    expect(company.length).toBeGreaterThan(0);
    const scope = new Set(company.map((d) => d.id));
    expect(publicDocumentsInScope(SEED_DOCUMENTS, scope)).toBe(0);
  });

  it("counts a public label that is in scope", () => {
    const label = SEED_DOCUMENTS.find((d) => d.sourceType === "public");
    expect(label).toBeDefined();
    expect(
      publicDocumentsInScope(SEED_DOCUMENTS, new Set([label!.id])),
    ).toBe(1);
  });
});

describe("an outage is not a document saying nothing", () => {
  it("reports unreadable, never nothing_found, when no reading could be made", () => {
    const outcome = reviewOutcome({
      publicDocumentsInScope: 1,
      answer: answer({
        reading: {
          status: "unavailable",
          reason: "no AI binding configured",
          model: null,
          gatewayRequestId: null,
          attemptedAt: NOW,
        },
      }),
    });
    expect(outcome.kind).toBe("unreadable");
    expect(outcome).toMatchObject({ reason: "no AI binding configured" });
  });

  it("reports nothing_found when the model read the passages and refused", () => {
    const outcome = reviewOutcome({
      publicDocumentsInScope: 1,
      answer: answer({
        reading: {
          status: "nothing_found",
          model: "test-model",
          gatewayRequestId: null,
          generatedAt: NOW,
        },
      }),
    });
    expect(outcome.kind).toBe("nothing_found");
  });

  it("reports nothing_found when retrieval returned nothing to read", () => {
    // A label IS held, and the search over it matched no passage. Nothing
    // failed, so this is not `unreadable`.
    const outcome = reviewOutcome({
      publicDocumentsInScope: 1,
      answer: answer({ reading: null }),
    });
    expect(outcome.kind).toBe("nothing_found");
  });
});

describe("a claim carries the passage behind it", () => {
  it("passes the verified span and its chunk through, and nothing else", () => {
    const outcome = reviewOutcome({ publicDocumentsInScope: 1, answer: read });
    expect(outcome).toEqual({
      kind: "read",
      chunkId: "public#1",
      quotedSpan: "Headaches/migraine 7% 11%",
      rationale: "The incidence table lists headache.",
    });
  });
});

describe("what a review is about", () => {
  const review: ChatReview = {
    outcome: { kind: "nothing_found" },
    citations: [],
    narrative: null,
    drug: "abacavir",
    computedFor: { drug: "abacavir", reaction: "headache" },
  };

  it("stands while the medicine and the reaction are unchanged", () => {
    expect(
      reviewIsCurrent(review, { drug: "abacavir", reaction: "headache" }),
    ).toBe(true);
  });

  it("does not stand once the medicine changes", () => {
    expect(
      reviewIsCurrent(review, { drug: "atorvastatin", reaction: "headache" }),
    ).toBe(false);
  });

  it("does not stand once the reaction changes", () => {
    expect(reviewIsCurrent(review, { drug: "abacavir", reaction: "rash" })).toBe(
      false,
    );
  });

  it("is never current when there is none", () => {
    expect(reviewIsCurrent(null, { drug: "abacavir", reaction: "rash" })).toBe(
      false,
    );
  });
});

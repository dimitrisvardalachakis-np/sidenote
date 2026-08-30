import { describe, expect, it } from "vitest";
import { IngestMessage, MAX_RETRIES } from "./messages";

/**
 * The queue's contract.
 *
 * A message is the one thing in this pipeline that crosses a process boundary
 * and comes back later, possibly to a different deploy of the code. So the
 * schema is the contract, and the consumer parses every message rather than
 * trusting it — a malformed message goes straight to the dead-letter queue
 * instead of being retried three times, because the bytes will not improve.
 */

describe("IngestMessage", () => {
  it("accepts the three steps of the pipeline", () => {
    const documentId = "11111111-1111-4111-8111-111111111111";
    const caseId = "22222222-2222-4222-8222-222222222222";

    expect(
      IngestMessage.safeParse({
        kind: "chunk_document",
        documentId,
        textKey: "company/abc.pdf.txt",
      }).success,
    ).toBe(true);

    expect(
      IngestMessage.safeParse({ kind: "embed_document", documentId }).success,
    ).toBe(true);

    expect(
      IngestMessage.safeParse({ kind: "assess_case", caseId }).success,
    ).toBe(true);
  });

  it("refuses a message for a step that does not exist", () => {
    expect(
      IngestMessage.safeParse({ kind: "summarise_case", caseId: "x" }).success,
    ).toBe(false);
  });

  it("refuses an id that is not a uuid", () => {
    // The ids address rows. A message carrying "../../etc/passwd" as a
    // document id is not a message this pipeline should retry.
    expect(
      IngestMessage.safeParse({
        kind: "embed_document",
        documentId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("carries ids and never payloads", () => {
    const parsed = IngestMessage.parse({
      kind: "chunk_document",
      documentId: "11111111-1111-4111-8111-111111111111",
      textKey: "company/abc.pdf.txt",
      // A Queues message is capped at 128 KB and the extracted text of a
      // 40-page CCDS is larger. Anything extra is dropped rather than carried.
      text: "the entire document text, which must not travel on the queue",
    });

    expect(parsed).not.toHaveProperty("text");
    expect(parsed.kind).toBe("chunk_document");
  });

  it("agrees with wrangler.jsonc about the retry count", () => {
    // The consumer's audit line says "attempt 2 of 3". A number that disagrees
    // with what the platform actually does is worse than no number.
    expect(MAX_RETRIES).toBe(3);
  });
});

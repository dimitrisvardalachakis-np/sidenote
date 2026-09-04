// @vitest-environment jsdom
/**
 * What a grounded panel says when the narrative fails and the reading did not.
 *
 * This is the common case on the deployed Worker, not an edge one: the
 * narrative does roughly twice the work of a reading against a budget that had
 * to be raised specifically for it, so it is the call that times out. The
 * panel used to lead with "No written answer could be produced from these
 * passages" and print the successful reading's own sentence far below it, in
 * the smallest available register — announcing a failure while the thing that
 * worked went unread.
 *
 * The rule these tests pin is narrow and it matters: a sentence is promoted
 * only when the model actually produced one. `reading.status !== "read"` must
 * keep saying exactly what it says today, because "the passages were retrieved
 * but not read" and "the model read them and here is what it found" are the
 * two states non-negotiable #5 exists to keep apart.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyEvidence, PublicEvidence } from "./evidence";
import type {
  Citation,
  GroundedNarrative,
  IsoDateTime,
  ListednessFinding,
  ModelReading,
} from "@/lib/schemas";

const AT = "2026-09-04T10:00:00.000Z" as IsoDateTime;
const RATIONALE =
  "The passage records jaundice as a rare post-marketing event.";

const CITATION: Citation = {
  chunkId: "doc-1#4",
  documentId: "0000000f-0000-4000-8000-000000000004",
  sourceType: "company",
  section: "4.8 Undesirable effects",
  quote: "Jaundice has been reported rarely in post-marketing experience.",
} as Citation;

const READ: ModelReading = {
  status: "read",
  chunkId: "doc-1#4",
  quotedSpan: "Jaundice has been reported rarely",
  rationale: RATIONALE,
  model: "@cf/meta/llama-3.1-8b-instruct-fp8",
  gatewayRequestId: "aig-1",
  generatedAt: AT,
} as ModelReading;

const NARRATIVE_FAILED: GroundedNarrative = {
  status: "unavailable",
  reason: "the model could not be reached (model call exceeded 20000ms)",
  model: "@cf/meta/llama-3.1-8b-instruct-fp8",
  gatewayRequestId: null,
  attemptedAt: AT,
} as GroundedNarrative;

function grounded(over: Partial<ListednessFinding> = {}): ListednessFinding {
  return {
    state: "grounded",
    documentKind: "ccds",
    citations: [CITATION],
    reading: READ,
    narrative: NARRATIVE_FAILED,
    retrievedAt: AT,
    ...over,
  } as ListednessFinding;
}

describe("a failed narrative beside a successful reading", () => {
  it("promotes the rationale to the summary the narrative would have held", () => {
    render(<CompanyEvidence finding={grounded()} />);
    const answer = screen.getByLabelText("AI-written answer");
    expect(answer).toHaveTextContent(RATIONALE);
  });

  /*
    Moved, not copied. `Reading` renders the same rationale by default, and
    leaving both would put one inference on the screen twice — which a reviewer
    scanning for corroboration would read as two sources agreeing.
  */
  it("prints that sentence exactly once in the panel", () => {
    const { container } = render(<CompanyEvidence finding={grounded()} />);
    const occurrences = (container.textContent ?? "").split(RATIONALE).length - 1;
    expect(occurrences).toBe(1);
  });

  it("keeps the quotation, the chunk id and the citation where they were", () => {
    render(<CompanyEvidence finding={grounded()} />);
    expect(screen.getByText("Jaundice has been reported rarely")).toBeTruthy();
    expect(screen.getAllByText("doc-1#4").length).toBeGreaterThan(0);
    expect(screen.getByText(/4.8 Undesirable effects/)).toBeTruthy();
  });

  it("keeps the failure visible rather than deleting it", () => {
    render(<CompanyEvidence finding={grounded()} />);
    expect(
      screen.getByText(/model call exceeded 20000ms/),
    ).toBeTruthy();
  });

  it("does the same on the public panel", () => {
    render(
      <PublicEvidence
        finding={
          {
            state: "grounded",
            citations: [{ ...CITATION, sourceType: "public" }],
            reading: READ,
            narrative: NARRATIVE_FAILED,
            labelSetId: null,
            retrievedAt: AT,
          } as never
        }
      />,
    );
    expect(screen.getByLabelText("AI-written answer")).toHaveTextContent(
      RATIONALE,
    );
  });
});

describe("what is not promoted", () => {
  /*
    A `read` whose sentence was discarded while its citation stood. There is
    nothing to promote, and inventing a summary from the passage text would be
    this component producing a reading of its own.
  */
  it("produces no summary when the reading carries no rationale", () => {
    render(
      <CompanyEvidence
        finding={grounded({ reading: { ...READ, rationale: null } as ModelReading })}
      />,
    );
    expect(screen.queryByLabelText("AI-written answer")).toBeNull();
  });

  it("produces no summary when the passages were retrieved but not read", () => {
    render(
      <CompanyEvidence
        finding={grounded({
          reading: {
            status: "unavailable",
            reason: "no Workers AI binding is configured in this environment",
            model: null,
            gatewayRequestId: null,
            attemptedAt: AT,
          } as ModelReading,
        })}
      />,
    );
    expect(screen.queryByLabelText("AI-written answer")).toBeNull();
    expect(
      screen.getByText(/no Workers AI binding is configured/),
    ).toBeTruthy();
  });

  it("produces no summary when the model read the passages and found none", () => {
    render(
      <CompanyEvidence
        finding={grounded({
          reading: {
            status: "nothing_found",
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            gatewayRequestId: "aig-2",
            generatedAt: AT,
          } as ModelReading,
        })}
      />,
    );
    expect(screen.queryByLabelText("AI-written answer")).toBeNull();
    expect(
      screen.getByText("No passage identified as describing this reaction"),
    ).toBeTruthy();
  });

  /*
    Null means no narrative was ever attempted, which is a different fact from
    one that was attempted and failed. Nothing renders in the slot, and the
    reading keeps its rationale in its own position.
  */
  it("leaves the rationale in place when no narrative was attempted", () => {
    render(<CompanyEvidence finding={grounded({ narrative: null })} />);
    expect(screen.queryByLabelText("AI-written answer")).toBeNull();
    expect(screen.getByText(RATIONALE)).toBeTruthy();
  });
});

describe("a narrative that succeeded is untouched", () => {
  it("renders the narrative points and leaves the rationale below", () => {
    render(
      <CompanyEvidence
        finding={grounded({
          narrative: {
            status: "narrated",
            points: [
              {
                chunkId: "doc-1#4",
                quotedSpan: "Jaundice has been reported rarely",
                sentence: "The CCDS records jaundice as rare.",
              },
            ],
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            gatewayRequestId: "aig-3",
            generatedAt: AT,
          } as GroundedNarrative,
        })}
      />,
    );
    expect(screen.getByLabelText("AI-written answer")).toHaveTextContent(
      "The CCDS records jaundice as rare.",
    );
    expect(screen.getByText(RATIONALE)).toBeTruthy();
  });
});

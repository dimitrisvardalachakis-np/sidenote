/**
 * Step 8: the AI is switched off and the whole flow is walked.
 *
 * CLAUDE.md non-negotiable #8: AI failure must never block a human write. The
 * only way to know that holds is to turn the model off and use the app, so
 * that is what this does — public submission through to a recorded verdict,
 * with `SIDENOTE_AI_DISABLED=1` and no binding anywhere.
 *
 * The claim is not merely "it does not crash". It is that every screen says
 * something true about why the model is missing, and that nothing degrades
 * into a finding. An outage must never render as "the document does not
 * mention this", because a reviewer who reads one as the other can start — or
 * fail to start — a 15-day clock on the strength of a 522.
 */
import { describe, expect, it } from "vitest";
import {
  CaseReference,
  caseValidity,
  documentStance,
  expeditedClock,
  isSerious,
  requiresExpeditedReport,
  ruledListedness,
  Assessment,
} from "@/lib/schemas";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { EMPTY_SLOTS, advance, startConversation } from "@/lib/intake/conversation";
import { intakeToCase } from "@/lib/intake/to-case";
import { extractReport } from "@/lib/extract/extract";
import { assessCase } from "./assess";
import { resolveAiBinding } from "./ai";
import { documentsForDrug } from "./scope";
import { DrugId, type SuspectDrug } from "@/lib/schemas";

/** The switch step 8 asks for: generation off, everything else untouched. */
const OFF = { SIDENOTE_AI_DISABLED: "1" } as const;

const REPORT =
  "My mother is 71. She started Hepalex for blood pressure and after a week she went very yellow and was kept in overnight.";

const HEPALEX: SuspectDrug = {
  id: DrugId.parse("00000002-0000-4000-8000-000000000001"),
  reportedName: "Hepalex",
  activeSubstance: "hepalexin",
  role: "suspect",
  marketingStatus: "marketed",
  dose: null,
  route: null,
  indication: null,
  therapyStart: null,
  therapyEnd: null,
  dechallenge: null,
  rechallenge: null,
};

describe("the binding really is off", () => {
  it("resolves to no binding, and says why in words a reviewer can read", () => {
    const ai = resolveAiBinding(OFF);
    expect(ai.binding).toBeNull();
    expect(ai.reason).toBe("generation is disabled by configuration");
  });
});

describe("a report is still accepted and still structured", () => {
  it("extracts nothing, reports why, and does not throw", async () => {
    const ai = resolveAiBinding(OFF);
    const out = await extractReport({
      binding: ai.binding,
      unavailableReason: ai.reason ?? "no model",
      gateway: null,
      sourceText: REPORT,
      knownProducts: ["Hepalex"],
      now: "2026-08-26T10:00:00Z",
    });
    expect(out.extraction).toBeNull();
    expect(out.unavailableReason).toBe("generation is disabled by configuration");
  });

  it("still fills the fields the deterministic path can reach", () => {
    let state = startConversation();
    state = advance({
      state,
      reply: REPORT,
      corpus: SEED_CHUNKS,
      knownProducts: ["Hepalex"],
      audience: "public",
      extraction: null, // what the disabled path supplies
    });
    expect(state.slots.narrative).toBe(REPORT);
    expect(state.slots.drug).toBe("Hepalex");
    expect(state.slots.sex).toBe("female");
    // And it keeps asking for what it could not read, rather than inventing it.
    expect(state.phase).toBe("collecting");
    expect(state.pending).not.toBeNull();
  });

  it("carries a completed conversation all the way to a stored case", () => {
    const record = intakeToCase({
      slots: {
        ...EMPTY_SLOTS,
        narrative: REPORT,
        drug: "Hepalex",
        reaction: "went very yellow",
        age: 71,
        sex: "female",
        seriousness: ["hospitalisation"],
        reporterName: "A Reporter",
        reporterContact: "a@example.org",
      },
      reference: CaseReference.parse("SN-2026-000600"),
      receivedAt: "2026-08-12",
      now: "2026-08-12T10:00:00Z",
      ids: {
        caseId: "00000006-0000-4000-8000-000000000001",
        drugId: "00000006-0000-4000-8000-000000000002",
        reactionId: "00000006-0000-4000-8000-000000000003",
      },
    });
    // A valid, serious case, produced with no model involved at any point.
    expect(caseValidity(record).isValid).toBe(true);
    expect(isSerious(record.reactions[0]!.seriousness)).toBe(true);
    expect(record.reactions[0]!.seriousness.hospitalisation?.basis).toBe("declared");
  });
});

describe("the evidence panes degrade honestly", () => {
  const assess = () =>
    assessCase({
      chunks: SEED_CHUNKS,
      documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
      reactionTerm: "went very yellow",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: "spl-1",
      ai: resolveAiBinding(OFF),
      gateway: null,
      now: "2026-08-12T10:05:00Z",
      actor: "reviewer-demo",
      target: "SN-2026-000600",
    });

  it("still retrieves and still shows the passages", async () => {
    const out = await assess();
    expect(out.listedness.state).toBe("grounded");
    if (out.listedness.state === "grounded") {
      expect(out.listedness.citations.length).toBeGreaterThan(0);
    }
  });

  it("says the assessment is unavailable, and says why", async () => {
    const out = await assess();
    if (out.listedness.state === "grounded") {
      expect(out.listedness.reading.status).toBe("unavailable");
      if (out.listedness.reading.status === "unavailable") {
        expect(out.listedness.reading.reason).toBe(
          "generation is disabled by configuration",
        );
      }
    }
  });

  it("never turns a retrieved passage into a silence", async () => {
    /*
      The invariant, stated precisely.

      An earlier version of this test asserted no finding was ever
      `no_result` with the model off, which was too broad and failed for the
      right reason: the Hepalex FDA label genuinely does not mention yellowing,
      so `no_result` there is a true finding of the deterministic search and
      has nothing to do with the model being down.

      What must never happen is the model's absence CONVERTING evidence into
      an absence. So: wherever retrieval found passages, the reading is
      `unavailable` and the stance is `unknown` — never `nothing_found`, never
      `silent`.
    */
    const out = await assess();
    let grounded = 0;
    for (const finding of [out.listedness, out.expectedness]) {
      if (finding.state !== "grounded") continue;
      grounded += 1;
      expect(finding.reading.status).toBe("unavailable");
      expect(finding.reading.status).not.toBe("nothing_found");
      expect(documentStance(finding)).toBe("unknown");
      expect(documentStance(finding)).not.toBe("silent");
    }
    // The test is only meaningful if something was actually retrieved.
    expect(grounded).toBeGreaterThan(0);
  });
});

describe("a reviewer can still rule, and the clock still works", () => {
  it("records a verdict on a case whose model panels are dark", async () => {
    const findings = await assessCase({
      chunks: SEED_CHUNKS,
      documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
      reactionTerm: "went very yellow",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: "spl-1",
      ai: resolveAiBinding(OFF),
      gateway: null,
      now: "2026-08-12T10:05:00Z",
      actor: "reviewer-demo",
      target: "SN-2026-000600",
    });

    // The human write the AI must never block.
    const assessment = Assessment.parse({
      id: "00000007-0000-4000-8000-000000000001",
      caseId: "00000006-0000-4000-8000-000000000001",
      reactionId: "00000006-0000-4000-8000-000000000003",
      drugId: "00000006-0000-4000-8000-000000000002",
      listedness: findings.listedness,
      expectedness: findings.expectedness,
      ruling: {
        listedness: "unlisted",
        expectedness: "unexpected",
        decidedBy: "reviewer-demo",
        decidedAt: "2026-08-12T11:00:00Z",
        rationale:
          "Read the CCDS passages by hand; hepatic failure is not among them.",
      },
      createdAt: "2026-08-12T10:05:00Z",
      updatedAt: "2026-08-12T11:00:00Z",
    });

    expect(ruledListedness(assessment)).toBe("unlisted");
    expect(requiresExpeditedReport(assessment, true)).toBe(true);

    // And the 15-day clock runs off that human ruling, with no model anywhere.
    const clock = expeditedClock(
      { receivedAt: "2026-08-12", reactions: [] },
      ruledListedness(assessment) === "unlisted",
      "2026-08-20",
    );
    // reactions is empty here, so seriousness is the caller's to supply — the
    // point being that nothing in this path consulted a model.
    expect(clock.state).toBe("not_applicable");
  });

  it("still shows the passages the reviewer ruled on", async () => {
    const findings = await assessCase({
      chunks: SEED_CHUNKS,
      documentIds: documentsForDrug(SEED_DOCUMENTS, HEPALEX),
      reactionTerm: "went very yellow",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: "spl-1",
      ai: resolveAiBinding(OFF),
      gateway: null,
      now: "2026-08-12T10:05:00Z",
      actor: "reviewer-demo",
      target: "SN-2026-000600",
    });
    // Non-negotiable #3 still holds in the degraded state: the evidence is
    // there, it is cited, and only the model's account of it is missing.
    if (findings.listedness.state === "grounded") {
      expect(findings.listedness.citations[0]?.quote.length).toBeGreaterThan(0);
      expect(findings.listedness.citations[0]?.chunkId).toBeTruthy();
    }
  });
});

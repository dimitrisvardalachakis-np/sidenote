/**
 * These tests are the domain rules from CLAUDE.md, written down as
 * executable claims. If a rule in that document changes, one of these should
 * go red.
 */
import { describe, expect, it } from "vitest";
import {
  Assessment,
  CaseReference,
  ChunkId,
  DocumentId,
  DrugId,
  ListednessFinding,
  NO_SERIOUSNESS_FLAGS,
  Patient,
  ReactionId,
  ReporterInfo,
  SERIOUSNESS_CRITERIA,
  SafetyDocument,
  SeriousnessFlags,
  caseValidity,
  documentStance,
  expeditedClock,
  expeditedDeadline,
  flaggedCriteria,
  isSerious,
  readingsDiverge,
  assertedCriteria,
  ruledListedness,
  sourcesDisagree,
  spanMatchesNarrative,
  type Citation,
  type Reaction,
  type SuspectDrug,
} from "./index";

type SeriousnessAssertionShape = {
  basis: "narrative" | "declared";
  trigger: { quote: string; start: number; end: number } | null;
  assertedBy: "model" | "reporter" | "reviewer";
  confirmedByReviewer: boolean;
  rejectedByReviewer: boolean;
};

const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

const NARRATIVE =
  "Two days after starting the tablets the patient was admitted to hospital with severe jaundice.";
const TRIGGER = "admitted to hospital";
const TRIGGER_AT = NARRATIVE.indexOf(TRIGGER);

const seriousReaction: Reaction = {
  id: ReactionId.parse(uuid(1)),
  verbatimTerm: "yellow skin and eyes",
  meddraPreferredTerm: "Jaundice",
  onset: { value: "2026-08-10", precision: "day" },
  outcome: "recovering",
  seriousness: {
    ...NO_SERIOUSNESS_FLAGS,
    hospitalisation: {
      kind: "initial",
      basis: "narrative",
      trigger: {
        quote: TRIGGER,
        start: TRIGGER_AT,
        end: TRIGGER_AT + TRIGGER.length,
      },
      assertedBy: "model",
      confirmedByReviewer: false,
      rejectedByReviewer: false,
    },
  },
};

const suspectDrug: SuspectDrug = {
  id: DrugId.parse(uuid(2)),
  reportedName: "Hepalex 20mg",
  activeSubstance: "hepalexin",
  role: "suspect",
  marketingStatus: "marketed",
  dose: "20mg once daily",
  route: "oral",
  indication: "hypertension",
  therapyStart: { value: "2026-08-08", precision: "day" },
  therapyEnd: null,
  dechallenge: null,
  rechallenge: null,
};

const identifiablePatient = Patient.parse({
  initials: "J.M.",
  ageYears: 61,
  ageGroup: null,
  sex: "female",
  dateOfBirth: null,
  weightKg: null,
  localIdentifier: null,
});

const identifiableReporter = ReporterInfo.parse({
  name: "Dr A Weber",
  organisation: null,
  country: "DE",
  qualification: "physician",
  email: "a.weber@example.org",
  phone: null,
  contactPermitted: true,
});

const emptyDraft = {
  patient: null,
  reporter: null,
  drugs: [] as SuspectDrug[],
  reactions: [] as Reaction[],
};

const completeDraft = {
  patient: identifiablePatient,
  reporter: identifiableReporter,
  drugs: [suspectDrug],
  reactions: [seriousReaction],
};

/** No model ran. The honest default everywhere in this project today. */
const NO_READING = {
  status: "unavailable" as const,
  reason: "no Workers AI binding is configured in this environment",
  model: null,
  gatewayRequestId: null,
  attemptedAt: "2026-08-24T09:00:00Z",
};

/** A verified reading, for the tests that need one. */
const readingOf = (chunkId: string) => ({
  status: "read" as const,
  chunkId,
  quotedSpan: "hepatic enzyme elevations have been reported",
  rationale: "The passage records hepatic enzyme elevations.",
  model: "@cf/meta/llama-3.1-8b-instruct",
  gatewayRequestId: "aig-log-1",
  generatedAt: "2026-08-24T09:00:00Z",
});

const companyCitation: Citation = {
  chunkId: ChunkId.parse("doc-a#12"),
  documentId: DocumentId.parse(uuid(3)),
  sourceType: "company",
  section: "4.8 Undesirable effects",
  quote: "hepatic enzyme elevations have been reported",
};

const publicCitation: Citation = {
  ...companyCitation,
  chunkId: ChunkId.parse("lbl-1#4"),
  sourceType: "public",
};

// ---------------------------------------------------------------------------

describe("the four minimum validity criteria", () => {
  it("reports all four missing for an empty submission", () => {
    expect(caseValidity(emptyDraft).missing).toEqual([
      "patient",
      "reporter",
      "suspect_drug",
      "event",
    ]);
    expect(caseValidity(emptyDraft).isValid).toBe(false);
  });

  it("accepts a report that has all four", () => {
    const v = caseValidity(completeDraft);
    expect(v.isValid).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.present).toHaveLength(4);
  });

  it("does not count a patient record that identifies nobody", () => {
    const blank = Patient.parse({
      initials: null,
      ageYears: null,
      ageGroup: null,
      sex: "unknown",
      dateOfBirth: null,
      weightKg: null,
      localIdentifier: null,
    });
    expect(caseValidity({ ...completeDraft, patient: blank }).missing).toContain(
      "patient",
    );
  });

  it("counts a patient identified by age alone", () => {
    const ageOnly = Patient.parse({
      initials: null,
      ageYears: 61,
      ageGroup: null,
      sex: null,
      dateOfBirth: null,
      weightKg: null,
      localIdentifier: null,
    });
    expect(
      caseValidity({ ...completeDraft, patient: ageOnly }).missing,
    ).not.toContain("patient");
  });

  it("does not accept 'a physician in Germany' as an identifiable reporter", () => {
    const anonymous = ReporterInfo.parse({
      name: null,
      organisation: null,
      country: "DE",
      qualification: "physician",
      email: null,
      phone: null,
      contactPermitted: true,
    });
    expect(
      caseValidity({ ...completeDraft, reporter: anonymous }).missing,
    ).toContain("reporter");
  });

  it("requires a SUSPECT drug, not merely any drug", () => {
    const concomitantOnly = {
      ...completeDraft,
      drugs: [{ ...suspectDrug, role: "concomitant" as const }],
    };
    expect(caseValidity(concomitantOnly).missing).toEqual(["suspect_drug"]);
  });

  it("is pure — the same input always gives the same answer", () => {
    expect(caseValidity(completeDraft)).toEqual(caseValidity(completeDraft));
  });
});

describe("seriousness", () => {
  it("treats any one of the six criteria as enough", () => {
    expect(isSerious(seriousReaction.seriousness)).toBe(true);
    expect(flaggedCriteria(seriousReaction.seriousness)).toEqual([
      "hospitalisation",
    ]);
  });

  it("has exactly the six criteria the regulation names", () => {
    expect(SERIOUSNESS_CRITERIA).toEqual([
      "death",
      "life_threatening",
      "hospitalisation",
      "persistent_disability",
      "congenital_anomaly",
      "other_medically_important",
    ]);
  });

  it("carries a trigger span that really is the text at those offsets", () => {
    const flag = seriousReaction.seriousness.hospitalisation;
    if (flag === null || flag.trigger === null) {
      throw new Error("expected a narrative-derived hospitalisation flag");
    }
    expect(spanMatchesNarrative(NARRATIVE, flag.trigger)).toBe(true);
  });

  it("notices a trigger span whose quote does not match the narrative", () => {
    expect(
      spanMatchesNarrative(NARRATIVE, {
        quote: "admitted to hospital",
        start: 0,
        end: 20,
      }),
    ).toBe(false);
  });

  it("cannot represent a narrative flag with no triggering phrase", () => {
    const result = SeriousnessFlags.safeParse({
      ...NO_SERIOUSNESS_FLAGS,
      death: {
        basis: "narrative",
        trigger: null,
        assertedBy: "model",
        confirmedByReviewer: false,
        rejectedByReviewer: false,
      },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["death", "trigger"]);
  });

  it("accepts a flag a reporter simply declared, with no phrase", () => {
    // A ticked box on the public form. There are no character offsets in a
    // checkbox, and pretending otherwise would be inventing evidence.
    const result = SeriousnessFlags.safeParse({
      ...NO_SERIOUSNESS_FLAGS,
      death: {
        basis: "declared",
        trigger: null,
        assertedBy: "reporter",
        confirmedByReviewer: false,
        rejectedByReviewer: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it("refuses a declared flag that claims a phrase it cannot have", () => {
    const result = SeriousnessFlags.safeParse({
      ...NO_SERIOUSNESS_FLAGS,
      death: {
        basis: "declared",
        trigger: { quote: "died", start: 0, end: 4 },
        assertedBy: "reporter",
        confirmedByReviewer: false,
        rejectedByReviewer: false,
      },
    });
    expect(result.success).toBe(false);
  });

  it("cannot represent a flag whose span is backwards", () => {
    expect(
      SeriousnessFlags.safeParse({
        ...NO_SERIOUSNESS_FLAGS,
        death: {
          basis: "narrative",
          trigger: { quote: "died", start: 40, end: 10 },
          assertedBy: "model",
          confirmedByReviewer: false,
          rejectedByReviewer: false,
        },
      }).success,
    ).toBe(false);
  });
});

describe("no citation, no claim (non-negotiable #3)", () => {
  const groundedBase = {
    state: "grounded" as const,
    documentKind: "ccds" as const,
    reading: NO_READING,
    retrievedAt: "2026-08-24T09:00:00Z",
  };

  it("accepts a grounded finding that cites a passage", () => {
    expect(
      ListednessFinding.safeParse({
        ...groundedBase,
        citations: [companyCitation],
      }).success,
    ).toBe(true);
  });

  it("rejects a grounded finding with an empty citation list", () => {
    expect(
      ListednessFinding.safeParse({ ...groundedBase, citations: [] }).success,
    ).toBe(false);
  });

  it("rejects listedness that cites a public label instead of a company doc", () => {
    const result = ListednessFinding.safeParse({
      ...groundedBase,
      citations: [publicCitation],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/company documents/);
  });

  it("distinguishes 'found nothing' from 'could not look'", () => {
    const noResult = ListednessFinding.safeParse({
      state: "no_result",
      documentKind: "ccds",
      query: "jaundice hepatic",
      retrievedAt: "2026-08-24T09:00:00Z",
    });
    const unavailable = ListednessFinding.safeParse({
      state: "source_unavailable",
      documentKind: "ccds",
      reason: "Vectorize timed out after 5s",
      attemptedAt: "2026-08-24T09:00:00Z",
    });
    expect(noResult.success).toBe(true);
    expect(unavailable.success).toBe(true);
    // Neither carries a determination — there is nowhere to put a claim.
    expect(noResult.data).not.toHaveProperty("determination");
    expect(unavailable.data).not.toHaveProperty("determination");
  });
});

describe("when the two sources disagree, that is the headline", () => {
  /**
   * A determination now exists in exactly one place: the reviewer's ruling.
   * These build an assessment whose findings carry passages and no verdict,
   * then rule on it — which is the order the real flow works in.
   */
  const ruled = (listed: string, expected: string) =>
    Assessment.parse({
      id: uuid(4),
      caseId: uuid(5),
      reactionId: uuid(1),
      drugId: uuid(2),
      createdAt: "2026-08-24T09:00:00Z",
      updatedAt: "2026-08-24T09:00:00Z",
      ruling: {
        listedness: listed,
        expectedness: expected,
        decidedBy: "reviewer-7",
        decidedAt: "2026-08-24T11:00:00Z",
        rationale: "Read both passages and ruled.",
      },
      listedness: {
        state: "grounded",
        documentKind: "ccds",
        citations: [companyCitation],
        reading: NO_READING,
        retrievedAt: "2026-08-24T09:00:00Z",
      },
      expectedness: {
        state: "grounded",
        citations: [publicCitation],
        reading: NO_READING,
        labelSetId: "abc-123",
        retrievedAt: "2026-08-24T09:00:00Z",
      },
    });

  it("sees no conflict when both sources agree", () => {
    expect(sourcesDisagree(ruled("listed", "expected"))).toBe(false);
    expect(sourcesDisagree(ruled("unlisted", "unexpected"))).toBe(false);
  });

  it("flags the company doc being ahead of the label", () => {
    expect(sourcesDisagree(ruled("listed", "unexpected"))).toBe(true);
  });

  it("flags the label being ahead of the company doc", () => {
    expect(sourcesDisagree(ruled("unlisted", "expected"))).toBe(true);
  });

  it("does not call an unresolved question a disagreement", () => {
    expect(sourcesDisagree(ruled("unlisted", "indeterminate"))).toBe(false);
    expect(sourcesDisagree(ruled("indeterminate", "expected"))).toBe(false);
  });

  it("has no determination at all until a reviewer rules", () => {
    const unruled = Assessment.parse({
      ...ruled("listed", "expected"),
      ruling: null,
    });
    // The model produced passages and a reading. Neither is a verdict, and
    // there is no field on a finding in which one could be recorded.
    expect(ruledListedness(unruled)).toBeNull();
    expect(sourcesDisagree(unruled)).toBe(false);
    expect(unruled.listedness).not.toHaveProperty("determination");
    expect(unruled.expectedness).not.toHaveProperty("determination");
  });
});

describe("what the documents were observed to say", () => {
  const withReadings = (company: unknown, label: unknown) =>
    Assessment.parse({
      id: uuid(4),
      caseId: uuid(5),
      reactionId: uuid(1),
      drugId: uuid(2),
      createdAt: "2026-08-24T09:00:00Z",
      updatedAt: "2026-08-24T09:00:00Z",
      ruling: null,
      listedness: {
        state: "grounded",
        documentKind: "ccds",
        citations: [companyCitation],
        reading: company,
        retrievedAt: "2026-08-24T09:00:00Z",
      },
      expectedness: {
        state: "grounded",
        citations: [publicCitation],
        reading: label,
        labelSetId: "abc-123",
        retrievedAt: "2026-08-24T09:00:00Z",
      },
    });

  const found = (c: Citation) => readingOf(c.chunkId);
  const silent = {
    status: "nothing_found" as const,
    model: "@cf/meta/llama-3.1-8b-instruct",
    gatewayRequestId: null,
    generatedAt: "2026-08-24T09:00:00Z",
  };

  it("reads a verified citation as the document describing the reaction", () => {
    const a = withReadings(found(companyCitation), silent);
    expect(documentStance(a.listedness)).toBe("describes");
    expect(documentStance(a.expectedness)).toBe("silent");
  });

  it("calls one describing and the other silent a divergence", () => {
    expect(readingsDiverge(withReadings(found(companyCitation), silent))).toBe(
      true,
    );
    expect(readingsDiverge(withReadings(silent, found(publicCitation)))).toBe(
      true,
    );
  });

  it("does not call agreement a divergence", () => {
    expect(readingsDiverge(withReadings(silent, silent))).toBe(false);
  });

  it("never calls an outage a divergence", () => {
    // The failure this exists to prevent: a model that could not be reached
    // must not make the two sources look like they conflict.
    expect(documentStance(withReadings(NO_READING, silent).listedness)).toBe(
      "unknown",
    );
    expect(readingsDiverge(withReadings(NO_READING, silent))).toBe(false);
    expect(readingsDiverge(withReadings(NO_READING, found(publicCitation)))).toBe(
      false,
    );
  });

  it("refuses a reading that cites a passage it was not given", () => {
    // The second of the two locks: verify.ts rejects an unknown chunk id at
    // generation time, and this rejects it for any Assessment parsed anywhere.
    const result = Assessment.safeParse({
      ...withReadings(silent, silent),
      listedness: {
        state: "grounded",
        documentKind: "ccds",
        citations: [companyCitation],
        reading: readingOf("doc-z#99"),
        retrievedAt: "2026-08-24T09:00:00Z",
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("the 15-day expedited clock", () => {
  const clockCase = { receivedAt: "2026-08-10", reactions: [seriousReaction] };

  it("counts 15 days from Day 0", () => {
    expect(expeditedDeadline("2026-08-10")).toBe("2026-08-25");
  });

  it("crosses a month boundary correctly", () => {
    expect(expeditedDeadline("2026-08-25")).toBe("2026-09-09");
  });

  it("runs while there is time left", () => {
    const c = expeditedClock(clockCase, true, "2026-08-20");
    expect(c).toEqual({ state: "running", dueOn: "2026-08-25", daysRemaining: 5 });
  });

  it("is still running, at zero, on the due date itself", () => {
    const c = expeditedClock(clockCase, true, "2026-08-25");
    expect(c).toEqual({ state: "running", dueOn: "2026-08-25", daysRemaining: 0 });
  });

  it("goes overdue the day after", () => {
    const c = expeditedClock(clockCase, true, "2026-08-26");
    expect(c).toEqual({ state: "overdue", dueOn: "2026-08-25", daysOverdue: 1 });
  });

  it("does not start for a serious but LISTED reaction", () => {
    expect(expeditedClock(clockCase, false, "2026-08-20").state).toBe(
      "not_applicable",
    );
  });

  it("does not start for an unlisted but NON-serious reaction", () => {
    const mild = {
      receivedAt: "2026-08-10",
      reactions: [{ ...seriousReaction, seriousness: NO_SERIOUSNESS_FLAGS }],
    };
    expect(expeditedClock(mild, true, "2026-08-20").state).toBe("not_applicable");
  });

  it("does not read the wall clock", () => {
    // Same inputs, same answer, regardless of when the suite runs.
    expect(expeditedClock(clockCase, true, "2026-08-20")).toEqual(
      expeditedClock(clockCase, true, "2026-08-20"),
    );
  });
});

describe("document invariants", () => {
  const base = {
    id: uuid(3),
    title: "Hepalex CCDS v7.2",
    activeSubstance: "hepalexin",
    version: "7.2",
    effectiveDate: "2026-01-15",
    objectKey: "company/hepalex/ccds-v7.2.pdf",
    chunkCount: 84,
    uploadedAt: "2026-08-01T10:00:00Z",
    rejectionReason: null,
    status: "embedded" as const,
  };

  it("keeps a CCDS in the company namespace", () => {
    expect(
      SafetyDocument.safeParse({ ...base, kind: "ccds", sourceType: "company" })
        .success,
    ).toBe(true);
    expect(
      SafetyDocument.safeParse({ ...base, kind: "ccds", sourceType: "public" })
        .success,
    ).toBe(false);
  });

  it("keeps an FDA label in the public namespace", () => {
    expect(
      SafetyDocument.safeParse({
        ...base,
        kind: "fda_label",
        sourceType: "public",
      }).success,
    ).toBe(true);
    expect(
      SafetyDocument.safeParse({
        ...base,
        kind: "fda_label",
        sourceType: "company",
      }).success,
    ).toBe(false);
  });

  it("will not let a document be rejected without a reason", () => {
    expect(
      SafetyDocument.safeParse({
        ...base,
        kind: "ccds",
        sourceType: "company",
        status: "rejected",
      }).success,
    ).toBe(false);
  });

  it("accepts the scanned-PDF rejection CLAUDE.md calls for", () => {
    expect(
      SafetyDocument.safeParse({
        ...base,
        kind: "ccds",
        sourceType: "company",
        status: "rejected",
        rejectionReason: "no_text_layer",
        chunkCount: 0,
      }).success,
    ).toBe(true);
  });
});

describe("identifiers", () => {
  it("accepts a well-formed public reference", () => {
    expect(CaseReference.parse("SN-2026-000412")).toBe("SN-2026-000412");
  });

  it("rejects anything else", () => {
    expect(CaseReference.safeParse("case-412").success).toBe(false);
    expect(CaseReference.safeParse("SN-26-412").success).toBe(false);
  });

  it("requires chunk ids to be non-empty", () => {
    expect(ChunkId.safeParse("").success).toBe(false);
  });
});

describe("a reviewer can put down a seriousness flag the model raised", () => {
  const withFlag = (over: Partial<SeriousnessAssertionShape>): SeriousnessFlags =>
    SeriousnessFlags.parse({
      ...NO_SERIOUSNESS_FLAGS,
      life_threatening: {
        basis: "narrative",
        trigger: { quote: "difficulty breathing", start: 0, end: 20 },
        assertedBy: "model",
        confirmedByReviewer: false,
        rejectedByReviewer: false,
        ...over,
      },
    });

  it("counts an unconfirmed flag, so a possibly-serious case surfaces at once", () => {
    expect(isSerious(withFlag({}))).toBe(true);
  });

  it("does not count a flag a reviewer has explicitly rejected", () => {
    // The bug: rejecting every flag left isSerious true, so the 15-day clock
    // kept running on a seriousness the reviewer had overruled. Seriousness
    // was the last input to that clock a model could assert unchallenged.
    expect(isSerious(withFlag({ rejectedByReviewer: true }))).toBe(false);
  });

  it("stops the expedited clock when the flag behind it is rejected", () => {
    const reaction = (flags: SeriousnessFlags): Reaction => ({
      ...seriousReaction,
      seriousness: flags,
    });
    const running = expeditedClock(
      { receivedAt: "2026-08-10", reactions: [reaction(withFlag({}))] },
      true,
      "2026-08-24",
    );
    const rejected = expeditedClock(
      {
        receivedAt: "2026-08-10",
        reactions: [reaction(withFlag({ rejectedByReviewer: true }))],
      },
      true,
      "2026-08-24",
    );
    expect(running.state).toBe("running");
    expect(rejected.state).toBe("not_applicable");
  });

  it("still shows a rejected flag on the record, so the overruling is auditable", () => {
    const flags = withFlag({ rejectedByReviewer: true });
    expect(flaggedCriteria(flags)).toEqual([]);
    expect(assertedCriteria(flags)).toEqual(["life_threatening"]);
  });
});

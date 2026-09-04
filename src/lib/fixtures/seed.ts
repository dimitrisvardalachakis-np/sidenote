/**
 * Three synthetic cases, and the AI output that would accompany them.
 *
 * Everything here is invented. The drugs do not exist, the patients do not
 * exist, and the quoted "CCDS" and "label" passages were written for this
 * demo. CLAUDE.md permits synthetic and public data only, and inventing the
 * drugs outright is safer than borrowing a real product's safety profile and
 * getting it subtly wrong.
 *
 * The retrieval findings are hardcoded this session, shaped exactly as
 * Cluster E will produce them — the same discriminated union with the same
 * three states — so swapping the fixture for a real call changes where the
 * data comes from and nothing about what renders.
 *
 * What they no longer contain is model output. Every finding here used to
 * carry a `determination` marked `suggestedBy: "model"`, which was a claim
 * about an inference that had never happened — there is no model in this
 * project. Those determinations were, in truth, the judgements of whoever
 * wrote this file, so they are now recorded as what they are: reviewer
 * rulings, each with a named reviewer and a stated reason. The readings are
 * `unavailable`, because that is the honest state of a system with no
 * Workers AI binding, and it is the state step 8 has to prove survivable.
 *
 * THERE USED TO BE TWELVE, chosen to exercise every state the screens can
 * render — a listed reaction with no clock, an outage on the company side, an
 * incomplete case, a flag the reporter merely ticked. They were cut to three
 * because the queue is now a demo script rather than a coverage matrix: six
 * cases that each show one thing, three of them real submitted rows. What
 * survives here is the overdue case, the case with a clock still running, and
 * the disagreement.
 *
 * The states the other nine demonstrated are not untested — `expeditedClock`,
 * `caseValidity` and `spanMatchesNarrative` are covered directly in
 * `schemas/schemas.test.ts`, and the panel states in
 * `components/evidence.test.tsx`. What was lost is the guarantee that the
 * SEEDED QUEUE exercises them, and `seed.test.ts` no longer claims it does.
 * If this file grows back, that spread is worth restoring with it.
 *
 * `buildSeedCases(today)` takes the date rather than reading a clock, for the
 * same reason expeditedClock does: the queue must be reproducible in a test
 * and must still show a believable spread of deadlines whenever it is opened.
 * Receipt dates are stored as offsets and resolved against `today`.
 */
import {
  Assessment,
  Case,
  CaseId,
  CaseReference,
  ChunkId,
  DocumentId,
  DrugId,
  NO_SERIOUSNESS_FLAGS,
  ReactionId,
  ReviewerId,
  type Citation,
  type ExpectednessDetermination,
  type ExpectednessFinding,
  type ListednessDetermination,
  type ListednessFinding,
  type ModelReading,
  type NarrativeSpan,
  type Reaction,
  type SeriousnessFlags,
  type SuspectDrug,
  type IsoDate,
} from "@/lib/schemas";

const MS_PER_DAY = 86_400_000;

function daysBefore(today: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${today}T00:00:00Z`) - days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Locate a phrase in the narrative and return its span.
 *
 * Computed rather than written by hand so every fixture satisfies
 * spanMatchesNarrative by construction. Hand-typed offsets drift the moment
 * anyone edits a narrative, and a highlight that points at the wrong words is
 * worse than no highlight.
 */
function span(narrative: string, phrase: string): NarrativeSpan {
  const start = narrative.indexOf(phrase);
  if (start < 0) {
    throw new Error(`Fixture phrase not found in narrative: "${phrase}"`);
  }
  return { quote: phrase, start, end: start + phrase.length };
}

/**
 * A readable, deterministic, and genuinely valid v4-shaped uuid.
 *
 * `kind` distinguishes cases from drugs from reactions so the ids are easy to
 * tell apart while debugging; `n` is the case number. The version nibble (4)
 * and variant (8) are fixed because DocumentId and friends validate the
 * format — which is how the first draft of this helper, which produced
 * twelve-character first groups, was caught before anything rendered.
 */
const UUID_KIND = {
  document: 1,
  case: 2,
  drug: 3,
  reaction: 4,
  assessment: 5,
} as const;

function fixtureUuid(kind: number, n: number): string {
  return `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// Invented products
// ---------------------------------------------------------------------------

/*
  Two, where there were five. Cardiquel, Dermacil and NRV-114 left with the
  cases that named them. Their DOCUMENTS are still in `fixtures/documents.ts`
  and deliberately so — the library is meant to hold more than the queue is
  working on, and an uploaded CCDS for a drug with no open case is the ordinary
  state of a real shelf.
*/

interface Product {
  readonly brand: string;
  readonly substance: string;
  readonly marketed: boolean;
  readonly indication: string;
}

const HEPALEX: Product = {
  brand: "Hepalex",
  substance: "hepalexin",
  marketed: true,
  indication: "hypertension",
};
const PULMOXA: Product = {
  brand: "Pulmoxa",
  substance: "pulmoxetine",
  marketed: true,
  indication: "idiopathic pulmonary fibrosis",
};

const CCDS_DOC = DocumentId.parse(fixtureUuid(UUID_KIND.document, 1));
const LABEL_DOC = DocumentId.parse(fixtureUuid(UUID_KIND.document, 3));

function companyCitation(
  section: string,
  quote: string,
  chunk: string,
): Citation {
  return {
    chunkId: ChunkId.parse(chunk),
    documentId: CCDS_DOC,
    sourceType: "company",
    section,
    quote,
  };
}

function labelCitation(section: string, quote: string, chunk: string): Citation {
  return {
    chunkId: ChunkId.parse(chunk),
    documentId: LABEL_DOC,
    sourceType: "public",
    section,
    quote,
  };
}

/**
 * A placeholder in the specs below, rewritten per case by `stampFinding`.
 *
 * Every other timestamp in this file is derived from `receivedAt`, which is
 * itself relative to `today`. This one used to be a pinned instant, so on any
 * date other than the one hard-coded here the retrieval was stamped days after
 * the ruling it supposedly informed — case 101 had a reviewer ruling on
 * evidence that would not be retrieved for another three weeks. Nothing read
 * the field, so nothing broke; it was simply untrue.
 */
const RETRIEVED_AT = "2026-08-24T08:15:00Z";

/**
 * No model has read these passages, because there is no model here.
 *
 * The alternative — writing a plausible rationale by hand and stamping it with
 * a model name — is exactly the fiction this file has just been cleaned of. A
 * fixture that claims an inference happened would also defeat step 10, which
 * checks quoted spans against their source chunk: a fabricated span would
 * either fail that check or, worse, be written to pass it.
 *
 * So the seeded queue demonstrates the degraded path by default. The citations
 * are real fixture passages and still render; the model's account of them is
 * honestly missing.
 */
const NO_READING: ModelReading = {
  status: "unavailable",
  reason: "no Workers AI binding is configured in this environment",
  model: null,
  gatewayRequestId: null,
  attemptedAt: RETRIEVED_AT,
};

// ---------------------------------------------------------------------------
// The three
// ---------------------------------------------------------------------------

interface CaseSpec {
  readonly n: number;
  readonly reference: string;
  readonly product: Product;
  readonly origin: Case["origin"];
  readonly receivedDaysAgo: number;
  readonly status: Case["status"];
  readonly assignedTo: string | null;
  readonly narrative: string;
  readonly verbatimTerm: string;
  readonly meddraPreferredTerm: string | null;
  readonly outcome: Reaction["outcome"];
  /** Phrases to flag, by criterion. Resolved into spans against the narrative. */
  readonly narrativeFlags?: Partial<Record<keyof SeriousnessFlags, string>>;
  /** Criteria the reporter simply ticked, with no phrase to point at. */
  readonly declaredFlags?: readonly (keyof SeriousnessFlags)[];
  readonly hospitalisationKind?: "initial" | "prolonged";
  readonly patient: {
    readonly initials: string | null;
    readonly ageYears: number | null;
    readonly sex: "male" | "female" | "unknown" | null;
  } | null;
  readonly reporter: {
    readonly name: string | null;
    readonly email: string | null;
    readonly qualification:
      | "physician"
      | "pharmacist"
      | "other_health_professional"
      | "consumer_or_carer"
      | "lawyer"
      | null;
  } | null;
  readonly listedness: ListednessFinding;
  readonly expectedness: ExpectednessFinding;
  /**
   * The reviewer's ruling, where one has been made. Absent on cases nobody has
   * finished working — and a case with no ruling has no expedited clock, which
   * is the whole point of making the determination the reviewer's.
   */
  readonly ruling?:
    | {
        readonly listedness: ListednessDetermination;
        readonly expectedness: ExpectednessDetermination;
        readonly by: string;
        readonly rationale: string;
      }
    | undefined;
}

const SPECS: readonly CaseSpec[] = [
  // 1 ─ OVERDUE. Serious, unlisted, and nobody has filed it.
  {
    n: 101,
    reference: "SN-2026-000101",
    product: HEPALEX,
    origin: "health_authority",
    receivedDaysAgo: 22,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "A 58-year-old man was started on Hepalex 20mg daily for high blood pressure. Eleven days later he became deeply jaundiced and confused. He was admitted to intensive care with acute liver failure and died four days after admission. No other new medicines had been started.",
    verbatimTerm: "liver failure, died",
    meddraPreferredTerm: "Hepatic failure",
    outcome: "fatal",
    narrativeFlags: {
      death: "died four days after admission",
      life_threatening: "acute liver failure",
      hospitalisation: "admitted to intensive care",
    },
    hospitalisationKind: "initial",
    patient: { initials: "R.T.", ageYears: 58, sex: "male" },
    reporter: {
      name: "MHRA Yellow Card",
      email: "yellowcard@example.gov",
      qualification: "physician",
    },
    ruling: {
      listedness: "unlisted",
      expectedness: "unexpected",
      by: "reviewer-demo",
      rationale:
        "CCDS 4.8 records transaminase elevation and rare jaundice, but not hepatic failure; the FDA label states no cases were seen in trials. Fatal outcome, so this is unlisted and expedited.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects › Hepatobiliary disorders",
          "Elevations in hepatic transaminases have been reported in approximately 2.1% of patients. Jaundice has been reported rarely.",
          "ccds-7.2#41",
        ),
      ],
      reading: NO_READING,
      narrative: null,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6 ADVERSE REACTIONS",
          "Hepatic enzyme elevations were observed in 2% of patients. No cases of hepatic failure were reported in clinical trials.",
          "lbl-hepalex#18",
        ),
      ],
      reading: NO_READING,
      narrative: null,
      labelSetId: "9f2a-hepalex-2025",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 2 ─ Two days left.
  {
    n: 102,
    reference: "SN-2026-000102",
    product: HEPALEX,
    origin: "email",
    receivedDaysAgo: 13,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "Patient reports that two weeks after starting the tablets her eyes and skin turned yellow. Her GP stopped the medicine and she was kept in hospital overnight for tests. The yellowing has started to fade since stopping.",
    verbatimTerm: "yellow skin and eyes",
    meddraPreferredTerm: "Jaundice",
    outcome: "recovering",
    narrativeFlags: { hospitalisation: "kept in hospital overnight" },
    hospitalisationKind: "initial",
    patient: { initials: "J.M.", ageYears: 61, sex: "female" },
    reporter: {
      name: "Dr A Weber",
      email: "a.weber@example.org",
      qualification: "physician",
    },
    ruling: {
      listedness: "unlisted",
      expectedness: "unexpected",
      by: "reviewer-demo",
      rationale:
        "Neither the CCDS adverse-reactions table nor the FDA label describes this reaction at this severity.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects › Hepatobiliary disorders",
          "Jaundice has been reported rarely.",
          "ccds-7.2#42",
        ),
      ],
      reading: NO_READING,
      narrative: null,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6 ADVERSE REACTIONS",
          "Hepatic enzyme elevations were observed in 2% of patients.",
          "lbl-hepalex#18",
        ),
      ],
      reading: NO_READING,
      narrative: null,
      labelSetId: "9f2a-hepalex-2025",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 3 ─ DISAGREEMENT: the public label describes it, the CCDS does not.
  {
    n: 105,
    reference: "SN-2026-000105",
    product: PULMOXA,
    origin: "email",
    receivedDaysAgo: 10,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "Progressive breathlessness developed six weeks into treatment. High-resolution CT showed new bilateral ground-glass opacities and the patient was hospitalised for investigation. Drug-induced interstitial lung disease was suspected and Pulmoxa was withdrawn.",
    verbatimTerm: "interstitial lung disease",
    meddraPreferredTerm: "Interstitial lung disease",
    outcome: "not_recovered",
    narrativeFlags: { hospitalisation: "hospitalised for investigation" },
    hospitalisationKind: "initial",
    patient: { initials: "H.S.", ageYears: 71, sex: "male" },
    reporter: {
      name: "Dr M Haddad",
      email: "m.haddad@example.org",
      qualification: "physician",
    },
    ruling: {
      listedness: "unlisted",
      expectedness: "expected",
      by: "reviewer-demo",
      rationale:
        "The FDA label describes the reaction but the current CCDS does not. Referred to the labelling team; treated as unlisted for reporting.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects › Respiratory, thoracic and mediastinal disorders",
          "Cough and dyspnoea were reported commonly. No cases of interstitial lung disease were identified in the pooled safety population.",
          "ccds-pulmoxa#28",
        ),
      ],
      reading: NO_READING,
      narrative: null,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "5.2 Interstitial Lung Disease",
          "Interstitial lung disease has been reported in patients receiving PULMOXA. Monitor for new or worsening respiratory symptoms.",
          "lbl-pulmoxa#5",
        ),
      ],
      reading: NO_READING,
      narrative: null,
      labelSetId: "51ae-pulmoxa-2026",
      retrievedAt: RETRIEVED_AT,
    },
  },
];

// ---------------------------------------------------------------------------

export interface SeededCase {
  readonly record: Case;
  readonly assessment: Assessment;
}

function buildFlags(spec: CaseSpec): SeriousnessFlags {
  const flags: Record<string, unknown> = { ...NO_SERIOUSNESS_FLAGS };

  for (const [criterion, phrase] of Object.entries(spec.narrativeFlags ?? {})) {
    if (typeof phrase !== "string") continue;
    const base = {
      basis: "narrative" as const,
      trigger: span(spec.narrative, phrase),
      assertedBy: "model" as const,
      confirmedByReviewer: spec.status === "assessed" || spec.status === "closed",
      rejectedByReviewer: false,
    };
    flags[criterion] =
      criterion === "hospitalisation"
        ? { ...base, kind: spec.hospitalisationKind ?? "initial" }
        : base;
  }

  for (const criterion of spec.declaredFlags ?? []) {
    const base = {
      basis: "declared" as const,
      trigger: null,
      assertedBy: "reporter" as const,
      confirmedByReviewer: false,
      rejectedByReviewer: false,
    };
    flags[criterion] =
      criterion === "hospitalisation"
        ? { ...base, kind: spec.hospitalisationKind ?? "initial" }
        : base;
  }

  return flags as SeriousnessFlags;
}

/**
 * Put a finding's timestamp on the case's own timeline.
 *
 * The specs carry a placeholder because they are written as plain literals and
 * have no access to `receivedAt`. The order that has to hold is
 * createdAt (09:00) < retrieved (09:05) < decided (14:20): evidence is
 * gathered before it is ruled on.
 */
function stampFinding<T extends { readonly state: string }>(
  finding: T,
  receivedAt: IsoDate,
): T {
  const at = `${receivedAt}T09:05:00Z`;
  const stamped =
    "retrievedAt" in finding
      ? { ...finding, retrievedAt: at }
      : { ...finding, attemptedAt: at };

  // The reading carries its own timestamp, and stamping only the outer one
  // left it pinned — reintroducing, one level down, exactly the defect the
  // comment above says this function fixes. A shallow copy is not a deep one.
  return "reading" in stamped && stamped.reading !== null
    ? { ...stamped, reading: { ...stamped.reading, attemptedAt: at } }
    : stamped;
}

function buildCase(spec: CaseSpec, today: IsoDate): SeededCase {
  const receivedAt = daysBefore(today, spec.receivedDaysAgo);
  const caseId = CaseId.parse(fixtureUuid(UUID_KIND.case, spec.n));
  const drugId = DrugId.parse(fixtureUuid(UUID_KIND.drug, spec.n));
  const reactionId = ReactionId.parse(fixtureUuid(UUID_KIND.reaction, spec.n));

  const drug: SuspectDrug = {
    id: drugId,
    reportedName: spec.product.brand,
    activeSubstance: spec.product.substance,
    role: "suspect",
    marketingStatus: spec.product.marketed ? "marketed" : "investigational",
    dose: null,
    route: null,
    indication: spec.product.indication,
    therapyStart: null,
    therapyEnd: null,
    dechallenge: null,
    rechallenge: null,
  };

  const reaction: Reaction = {
    id: reactionId,
    verbatimTerm: spec.verbatimTerm,
    meddraPreferredTerm: spec.meddraPreferredTerm,
    onset: null,
    outcome: spec.outcome,
    seriousness: buildFlags(spec),
  };

  const record = Case.parse({
    id: caseId,
    reference: CaseReference.parse(spec.reference),
    origin: spec.origin,
    receivedAt,
    patient:
      spec.patient === null
        ? null
        : {
            initials: spec.patient.initials,
            ageYears: spec.patient.ageYears,
            ageGroup: null,
            sex: spec.patient.sex,
            dateOfBirth: null,
            weightKg: null,
            localIdentifier: null,
          },
    reporter:
      spec.reporter === null
        ? null
        : {
            name: spec.reporter.name,
            organisation: null,
            country: "GB",
            qualification: spec.reporter.qualification,
            email: spec.reporter.email,
            phone: null,
            contactPermitted: true,
          },
    drugs: [drug],
    reactions: [reaction],
    narrative: spec.narrative,
    status: spec.status,
    assignedTo:
      spec.assignedTo === null ? null : ReviewerId.parse(spec.assignedTo),
    createdAt: `${receivedAt}T09:00:00Z`,
    updatedAt: `${receivedAt}T09:00:00Z`,
  });

  const assessment = Assessment.parse({
    id: fixtureUuid(UUID_KIND.assessment, spec.n),
    caseId,
    reactionId,
    drugId,
    listedness: stampFinding(spec.listedness, receivedAt),
    expectedness: stampFinding(spec.expectedness, receivedAt),
    ruling:
      spec.ruling === undefined
        ? null
        : {
            listedness: spec.ruling.listedness,
            expectedness: spec.ruling.expectedness,
            decidedBy: ReviewerId.parse(spec.ruling.by),
            decidedAt: `${receivedAt}T14:20:00Z`,
            rationale: spec.ruling.rationale,
          },
    createdAt: `${receivedAt}T09:05:00Z`,
    updatedAt: `${receivedAt}T09:05:00Z`,
  });

  return { record, assessment };
}

/**
 * The seeded queue, as of `today`.
 *
 * Every Case and Assessment is run through its zod schema, so a fixture that
 * violates a domain rule fails loudly here rather than rendering something
 * impossible. That has already caught two of these by hand.
 */
export function buildSeedCases(today: IsoDate): readonly SeededCase[] {
  return SPECS.map((spec) => buildCase(spec, today));
}

export function findSeedCase(
  today: IsoDate,
  caseId: string,
): SeededCase | null {
  return buildSeedCases(today).find((c) => c.record.id === caseId) ?? null;
}

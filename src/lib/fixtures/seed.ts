/**
 * Twelve synthetic cases, and the AI output that would accompany them.
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
const CARDIQUEL: Product = {
  brand: "Cardiquel",
  substance: "cardiquelin",
  marketed: true,
  indication: "atrial fibrillation",
};
const DERMACIL: Product = {
  brand: "Dermacil",
  substance: "dermacilin",
  marketed: true,
  indication: "plaque psoriasis",
};
const PULMOXA: Product = {
  brand: "Pulmoxa",
  substance: "pulmoxetine",
  marketed: true,
  indication: "idiopathic pulmonary fibrosis",
};
const NEUROVAST: Product = {
  brand: "NRV-114",
  substance: "vastimab",
  marketed: false,
  indication: "relapsing multiple sclerosis (trial NRV-114-003)",
};

const CCDS_DOC = DocumentId.parse(fixtureUuid(UUID_KIND.document, 1));
const IB_DOC = DocumentId.parse(fixtureUuid(UUID_KIND.document, 2));
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

function ibCitation(section: string, quote: string, chunk: string): Citation {
  return {
    chunkId: ChunkId.parse(chunk),
    documentId: IB_DOC,
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
// The twelve
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
      labelSetId: "9f2a-hepalex-2025",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 3 ─ Serious but listed. No clock: the reaction is already known.
  {
    n: 103,
    reference: "SN-2026-000103",
    product: CARDIQUEL,
    origin: "email",
    receivedDaysAgo: 6,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "Widespread itchy rash appeared on the third day of treatment. The patient attended A&E and was admitted for observation overnight. The rash settled with antihistamines after the drug was withdrawn.",
    verbatimTerm: "widespread itchy rash",
    meddraPreferredTerm: "Rash generalised",
    outcome: "recovered",
    narrativeFlags: { hospitalisation: "admitted for observation overnight" },
    hospitalisationKind: "initial",
    patient: { initials: "K.O.", ageYears: 44, sex: "female" },
    reporter: {
      name: "P. Nowak",
      email: "p.nowak@example.org",
      qualification: "pharmacist",
    },
    ruling: {
      listedness: "listed",
      expectedness: "expected",
      by: "reviewer-demo",
      rationale:
        "The reaction is described in CCDS 4.8 and in the FDA label at comparable frequency; no new information.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects › Skin and subcutaneous tissue disorders",
          "Rash, including generalised rash requiring hospitalisation, occurred in 1.2% of patients.",
          "ccds-cardiquel#33",
        ),
      ],
      reading: NO_READING,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6.1 Clinical Trials Experience",
          "Rash occurred in 1.2% of patients receiving CARDIQUEL.",
          "lbl-cardiquel#9",
        ),
      ],
      reading: NO_READING,
      labelSetId: "3c81-cardiquel-2024",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 4 ─ DISAGREEMENT. Company document ahead of the label.
  {
    n: 104,
    reference: "SN-2026-000104",
    product: DERMACIL,
    origin: "literature",
    receivedDaysAgo: 9,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "Case report describes a 33-year-old woman who developed painful mucosal ulceration and skin detachment over 30% of body surface area after four weeks of Dermacil. A diagnosis of Stevens-Johnson syndrome was made and she required intensive care.",
    verbatimTerm: "Stevens-Johnson syndrome",
    meddraPreferredTerm: "Stevens-Johnson syndrome",
    outcome: "recovered_with_sequelae",
    narrativeFlags: {
      life_threatening: "skin detachment over 30% of body surface area",
      hospitalisation: "required intensive care",
    },
    hospitalisationKind: "initial",
    patient: { initials: "L.F.", ageYears: 33, sex: "female" },
    reporter: {
      name: "J. Okafor",
      email: "j.okafor@example.org",
      qualification: "physician",
    },
    ruling: {
      listedness: "listed",
      expectedness: "unexpected",
      by: "reviewer-demo",
      rationale:
        "The CCDS was updated to include this reaction; the FDA label has not yet caught up. Company document takes precedence for listedness.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects › Skin and subcutaneous tissue disorders",
          "Severe cutaneous adverse reactions, including Stevens-Johnson syndrome and toxic epidermal necrolysis, have been reported very rarely. Added in CCDS version 9.0, March 2026.",
          "ccds-dermacil#57",
        ),
      ],
      reading: NO_READING,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6 ADVERSE REACTIONS",
          "The most common adverse reactions were injection site erythema, upper respiratory tract infection and headache.",
          "lbl-dermacil#12",
        ),
      ],
      reading: NO_READING,
      labelSetId: "77bd-dermacil-2024",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 5 ─ DISAGREEMENT the other way, and the clock is running.
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
      labelSetId: "51ae-pulmoxa-2026",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 6 ─ Not serious. No flags at all.
  {
    n: 106,
    reference: "SN-2026-000106",
    product: CARDIQUEL,
    origin: "public_form",
    receivedDaysAgo: 3,
    status: "received",
    assignedTo: null,
    narrative:
      "Felt queasy for about an hour after each dose during the first week. It settled by itself and I am still taking the tablets.",
    verbatimTerm: "queasy",
    meddraPreferredTerm: "Nausea",
    outcome: "recovered",
    patient: { initials: "B.A.", ageYears: 52, sex: "female" },
    reporter: {
      name: "B. Andersson",
      email: "b.andersson@example.org",
      qualification: "consumer_or_carer",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects",
          "The most frequently reported adverse reactions are nausea (12.4%), headache (9.1%) and fatigue (7.8%).",
          "ccds-cardiquel#21",
        ),
      ],
      reading: NO_READING,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6.1 Clinical Trials Experience",
          "Nausea was reported by 12% of patients.",
          "lbl-cardiquel#8",
        ),
      ],
      reading: NO_READING,
      labelSetId: "3c81-cardiquel-2024",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 7 ─ SOURCE UNAVAILABLE on the company side. No determination is possible,
  //     so no clock can start — the absence of an answer is not "unlisted".
  {
    n: 107,
    reference: "SN-2026-000107",
    product: NEUROVAST,
    origin: "clinical_trial",
    receivedDaysAgo: 4,
    status: "in_review",
    assignedTo: "reviewer-demo",
    narrative:
      "Trial subject developed a fever of 39.1C with a neutrophil count of 0.4 x10^9/L on day 21. Study drug was held and the subject was admitted for intravenous antibiotics. Counts recovered over five days.",
    verbatimTerm: "febrile neutropenia",
    meddraPreferredTerm: "Febrile neutropenia",
    outcome: "recovered",
    narrativeFlags: {
      hospitalisation: "admitted for intravenous antibiotics",
      life_threatening: "neutrophil count of 0.4 x10^9/L",
    },
    hospitalisationKind: "initial",
    patient: { initials: "S.V.", ageYears: 29, sex: "female" },
    reporter: {
      name: "Site 004 Investigator",
      email: "site004@example.org",
      qualification: "physician",
    },
    listedness: {
      state: "source_unavailable",
      documentKind: "investigators_brochure",
      reason: "Vectorize query timed out after 5s (company namespace)",
      attemptedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "no_result",
      query: "febrile neutropenia vastimab",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 8 ─ NO RESULT on the public side, which is correct: an investigational
  //     product has no FDA label to be expected against.
  {
    n: 108,
    reference: "SN-2026-000108",
    product: NEUROVAST,
    origin: "clinical_trial",
    receivedDaysAgo: 6,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "During the second infusion the subject developed flushing, throat tightness and hypotension. The infusion was stopped immediately and adrenaline was given. Symptoms resolved within the hour and the subject was observed overnight.",
    verbatimTerm: "infusion reaction with throat tightness",
    meddraPreferredTerm: "Anaphylactic reaction",
    outcome: "recovered",
    narrativeFlags: {
      life_threatening: "throat tightness and hypotension",
      hospitalisation: "observed overnight",
    },
    hospitalisationKind: "prolonged",
    patient: { initials: "D.K.", ageYears: 37, sex: "male" },
    reporter: {
      name: "Site 011 Investigator",
      email: "site011@example.org",
      qualification: "physician",
    },
    ruling: {
      listedness: "unlisted",
      expectedness: "indeterminate",
      by: "reviewer-demo",
      rationale:
        "Not described in the CCDS. No label passage could be retrieved, so expectedness cannot be stated either way.",
    },
    listedness: {
      state: "grounded",
      documentKind: "investigators_brochure",
      citations: [
        ibCitation(
          "6.3 Reference Safety Information",
          "Infusion-related reactions were mild to moderate and comprised flushing and headache. No anaphylactic reactions have been observed to date.",
          "ib-nrv114-v4#63",
        ),
      ],
      reading: NO_READING,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "no_result",
      query: "anaphylaxis vastimab NRV-114",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 9 ─ Incomplete. The reporter cannot be identified, so it is not yet a
  //     valid case and has not been assessed.
  {
    n: 109,
    reference: "SN-2026-000109",
    product: HEPALEX,
    origin: "email",
    receivedDaysAgo: 2,
    status: "received",
    assignedTo: null,
    narrative:
      "Forwarded message mentions dizziness on standing after starting a blood pressure tablet. No contact details were included and the sender address bounced.",
    verbatimTerm: "dizziness on standing",
    meddraPreferredTerm: null,
    outcome: "unknown",
    patient: { initials: null, ageYears: 67, sex: null },
    reporter: null,
    listedness: {
      state: "no_result",
      documentKind: "ccds",
      query: "dizziness postural hypotension hepalexin",
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "no_result",
      query: "dizziness postural hypotension hepalexin",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 10 ─ Due today. Zero days left is still "running", not overdue.
  {
    n: 110,
    reference: "SN-2026-000110",
    product: DERMACIL,
    origin: "email",
    receivedDaysAgo: 15,
    status: "assessed",
    assignedTo: "reviewer-demo",
    narrative:
      "Sudden swelling of the lips and tongue occurred within an hour of the second injection. The patient had difficulty breathing and called an ambulance. Treated with adrenaline and steroids in the emergency department.",
    verbatimTerm: "swelling of lips and tongue",
    meddraPreferredTerm: "Angioedema",
    outcome: "recovered",
    narrativeFlags: { life_threatening: "difficulty breathing" },
    patient: { initials: "N.P.", ageYears: 48, sex: "female" },
    reporter: {
      name: "E. Rossi",
      email: "e.rossi@example.org",
      qualification: "other_health_professional",
    },
    ruling: {
      listedness: "unlisted",
      expectedness: "unexpected",
      by: "reviewer-demo",
      rationale:
        "Absent from both the CCDS and the FDA label. Life-threatening airway swelling, so the expedited clock applies.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects › Immune system disorders",
          "Hypersensitivity reactions have been reported. Angioedema has not been observed in clinical studies.",
          "ccds-dermacil#44",
        ),
      ],
      reading: NO_READING,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6 ADVERSE REACTIONS",
          "Hypersensitivity reactions including urticaria were reported in less than 1% of patients.",
          "lbl-dermacil#13",
        ),
      ],
      reading: NO_READING,
      labelSetId: "77bd-dermacil-2024",
      retrievedAt: RETRIEVED_AT,
    },
  },

  // 11 ─ Came in through the public form, so the seriousness flag is one the
  //      reporter TICKED. There is no phrase to highlight, and the case screen
  //      has to say so rather than invent one.
  {
    n: 111,
    reference: "SN-2026-000111",
    product: PULMOXA,
    origin: "public_form",
    receivedDaysAgo: 4,
    status: "received",
    assignedTo: null,
    narrative:
      "My husband started this medicine in June. He got very short of breath and they kept him in for four nights. He is home now but still not right.",
    verbatimTerm: "very short of breath",
    meddraPreferredTerm: null,
    outcome: "not_recovered",
    declaredFlags: ["hospitalisation"],
    hospitalisationKind: "initial",
    patient: { initials: "G.W.", ageYears: 74, sex: "male" },
    reporter: {
      name: "M. Wallace",
      email: "m.wallace@example.org",
      qualification: "consumer_or_carer",
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
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "source_unavailable",
      reason: "openFDA returned 503 (upstream unavailable)",
      attemptedAt: RETRIEVED_AT,
    },
  },

  // 12 ─ Finished. Not serious, listed, closed.
  {
    n: 112,
    reference: "SN-2026-000112",
    product: HEPALEX,
    origin: "public_form",
    receivedDaysAgo: 28,
    status: "closed",
    assignedTo: "reviewer-demo",
    narrative:
      "Mild headache for the first three days of treatment, then nothing. I carried on taking it and have had no further trouble.",
    verbatimTerm: "mild headache",
    meddraPreferredTerm: "Headache",
    outcome: "recovered",
    patient: { initials: "T.C.", ageYears: 39, sex: "male" },
    reporter: {
      name: "T. Cole",
      email: "t.cole@example.org",
      qualification: "consumer_or_carer",
    },
    ruling: {
      listedness: "listed",
      expectedness: "expected",
      by: "reviewer-demo",
      rationale:
        "Described in both the CCDS and the FDA label. Closed with no expedited action required.",
    },
    listedness: {
      state: "grounded",
      documentKind: "ccds",
      citations: [
        companyCitation(
          "4.8 Undesirable effects",
          "The most frequently reported adverse reactions are nausea, headache and fatigue.",
          "ccds-7.2#21",
        ),
      ],
      reading: NO_READING,
      retrievedAt: RETRIEVED_AT,
    },
    expectedness: {
      state: "grounded",
      citations: [
        labelCitation(
          "6 ADVERSE REACTIONS",
          "Headache was reported by 9% of patients.",
          "lbl-hepalex#17",
        ),
      ],
      reading: NO_READING,
      labelSetId: "9f2a-hepalex-2025",
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

/**
 * Synthetic safety documents, chunked by the real chunker.
 *
 * These exist so the library is not empty on a fresh checkout and the intake
 * chat has something genuine to retrieve against. The text is invented, the
 * products do not exist, and the chunking is done by chunkDocument at module
 * load — so what the chat searches is the same pipeline output an uploaded PDF
 * produces, not a hand-written shortcut.
 *
 * Uploaded documents are merged with these at read time. Nothing here is
 * written to disk.
 *
 * EVERY PRODUCT IN THE SEEDED QUEUE HAS A DOCUMENT HERE, and that is a
 * requirement rather than a tidiness. For a long while only Covaxil and
 * Hepalex did, while the queue carried cases for four other drugs whose
 * assessments were written out by hand in `seed.ts`. Those cases rendered a
 * confident "Sources disagree" badge — derived from the reviewer ruling, so it
 * survives anything — above two panels that collapsed to "Source unavailable"
 * the moment anybody pressed Re-assess. The badge and its evidence disagreed,
 * and the evidence was the honest half.
 *
 * So the passages `seed.ts` quotes are the passages these documents contain,
 * word for word. A fixture citation is now a citation of something.
 */
import { chunkDocument } from "@/lib/ingest/chunk";
import {
  DocumentId,
  SafetyDocument,
  type DocumentChunk,
  type DocumentKind,
  type SourceType,
} from "@/lib/schemas";

interface DocSpec {
  readonly n: number;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly activeSubstance: string;
  readonly version: string | null;
  readonly effectiveDate: string | null;
  readonly text: string;
}

const docId = (n: number) =>
  `0000000f-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SPECS: readonly DocSpec[] = [
  {
    n: 1,
    title: "Covaxil — Prescribing Information",
    kind: "fda_label",
    activeSubstance: "covaxilin",
    version: "2026.1",
    effectiveDate: "2026-02-11",
    text: `COVAXIL (covaxilin) injection, for intramuscular use

1 INDICATIONS AND USAGE

COVAXIL is indicated for the prevention of coronavirus disease in individuals 12 years of age and older.

5 WARNINGS AND PRECAUTIONS

5.1 Hypersensitivity Reactions

Severe hypersensitivity reactions, including anaphylaxis, have been reported following administration of COVAXIL. Appropriate medical treatment and supervision must be available in case of an anaphylactic reaction.

5.2 Cutaneous Reactions

Delayed cutaneous reactions have been observed, typically appearing between two and eight days after injection. Presentations have included erythema, urticaria and a pruritic maculopapular eruption affecting the hands and forearms. Most cases were mild to moderate and resolved without treatment within one week.

6 ADVERSE REACTIONS

6.1 Clinical Trials Experience

The most frequently reported adverse reactions were injection site pain (68%), fatigue (54%), headache (41%), myalgia (37%), and erythema at the injection site (12%).

Cutaneous reactions distant from the injection site, including rash affecting the hands, were reported in 1.4% of participants. These were self-limiting in the large majority of cases.

6.2 Postmarketing Experience

The following adverse reactions have been identified during postmarketing use: anaphylaxis, angioedema, and Bell's palsy. Because these reactions are reported voluntarily from a population of uncertain size, it is not always possible to reliably estimate their frequency.`,
  },
  {
    n: 2,
    title: "Covaxil Company Core Data Sheet v3.1",
    kind: "ccds",
    activeSubstance: "covaxilin",
    version: "3.1",
    effectiveDate: "2026-05-02",
    text: `COVAXIL COMPANY CORE DATA SHEET

Version 3.1. Confidential. For internal pharmacovigilance use only.

4.8 UNDESIRABLE EFFECTS

Skin and subcutaneous tissue disorders

Very common: injection site erythema. Common: rash, pruritus. Uncommon: urticaria, angioedema.

Delayed cutaneous reactions involving the hands and forearms have been characterised in the pooled safety population and occurred in 1.4% of subjects. A small number of cases progressed to a vesicular eruption requiring topical corticosteroids.

Immune system disorders

Rare: anaphylaxis. Very rare: serum sickness-like reaction.

Nervous system disorders

Common: headache. Uncommon: dizziness, paraesthesia. Rare: Bell's palsy.

4.9 OVERDOSE

No cases of overdose have been reported.`,
  },
  {
    n: 3,
    title: "Hepalex — Prescribing Information",
    kind: "fda_label",
    activeSubstance: "hepalexin",
    version: "2025.4",
    effectiveDate: "2025-11-20",
    text: `HEPALEX (hepalexin) tablets, for oral use

6 ADVERSE REACTIONS

The most frequently reported adverse reactions were nausea (12%), headache (9%), and fatigue (8%).

Hepatic enzyme elevations were observed in 2% of patients receiving HEPALEX in controlled trials. These were generally asymptomatic and reversible on discontinuation. No cases of hepatic failure were reported in clinical trials.

8 USE IN SPECIFIC POPULATIONS

8.1 Pregnancy

There are no adequate and well-controlled studies in pregnant women.`,
  },
  {
    n: 4,
    title: "Hepalex Company Core Data Sheet v7.2",
    kind: "ccds",
    activeSubstance: "hepalexin",
    version: "7.2",
    effectiveDate: "2026-03-14",
    text: `HEPALEX COMPANY CORE DATA SHEET

Version 7.2. Confidential.

4.8 UNDESIRABLE EFFECTS

Hepatobiliary disorders

Elevations in hepatic transaminases have been reported in approximately 2.1% of patients. Jaundice has been reported rarely in post-marketing experience.

Gastrointestinal disorders

The most frequently reported adverse reactions are nausea, headache and fatigue.`,
  },
  {
    n: 5,
    title: "Cardiquel — Prescribing Information",
    kind: "fda_label",
    activeSubstance: "cardiquelin",
    version: "2024.2",
    effectiveDate: "2024-07-09",
    text: `CARDIQUEL (cardiquelin) tablets, for oral use

1 INDICATIONS AND USAGE

CARDIQUEL is indicated for the maintenance of sinus rhythm in adults with paroxysmal atrial fibrillation.

5 WARNINGS AND PRECAUTIONS

5.1 Hypersensitivity Reactions

Hypersensitivity reactions, including generalised rash, have been reported. Discontinue CARDIQUEL if a severe reaction occurs.

6 ADVERSE REACTIONS

6.1 Clinical Trials Experience

Nausea was reported by 12% of patients. Headache was reported by 9% and fatigue by 8%.

Rash occurred in 1.2% of patients receiving CARDIQUEL. Cases requiring admission for observation were reported infrequently and resolved on withdrawal of the drug.

6.2 Postmarketing Experience

The following adverse reactions have been identified during postmarketing use: bradycardia, dizziness, and first-degree atrioventricular block.`,
  },
  {
    n: 6,
    title: "Cardiquel Company Core Data Sheet v4.0",
    kind: "ccds",
    activeSubstance: "cardiquelin",
    version: "4.0",
    effectiveDate: "2025-09-30",
    text: `CARDIQUEL COMPANY CORE DATA SHEET

Version 4.0. Confidential. For internal pharmacovigilance use only.

4.8 UNDESIRABLE EFFECTS

The most frequently reported adverse reactions are nausea (12.4%), headache (9.1%) and fatigue (7.8%).

Skin and subcutaneous tissue disorders

Rash, including generalised rash requiring hospitalisation, occurred in 1.2% of patients. Pruritus and urticaria have been reported uncommonly, and resolved on withdrawal.

Cardiac disorders

Common: bradycardia. Uncommon: first-degree atrioventricular block.

4.9 OVERDOSE

Overdose has been associated with prolonged bradycardia. Management is supportive.`,
  },
  {
    n: 7,
    title: "Dermacil — Prescribing Information",
    kind: "fda_label",
    activeSubstance: "dermacilin",
    version: "2024.3",
    effectiveDate: "2024-10-17",
    text: `DERMACIL (dermacilin) injection, for subcutaneous use

1 INDICATIONS AND USAGE

DERMACIL is indicated for the treatment of moderate to severe plaque psoriasis in adults who are candidates for systemic therapy.

5 WARNINGS AND PRECAUTIONS

5.1 Infections

DERMACIL may increase the risk of infection. Do not initiate treatment in patients with a clinically important active infection.

6 ADVERSE REACTIONS

The most common adverse reactions were injection site erythema, upper respiratory tract infection and headache.

Hypersensitivity reactions including urticaria were reported in less than 1% of patients.

8 USE IN SPECIFIC POPULATIONS

8.1 Pregnancy

Available data on DERMACIL use in pregnant women are insufficient to establish a drug-associated risk.`,
  },
  {
    n: 8,
    title: "Dermacil Company Core Data Sheet v9.0",
    kind: "ccds",
    activeSubstance: "dermacilin",
    version: "9.0",
    effectiveDate: "2026-03-02",
    text: `DERMACIL COMPANY CORE DATA SHEET

Version 9.0. Confidential.

4.8 UNDESIRABLE EFFECTS

Skin and subcutaneous tissue disorders

Very common: injection site erythema. Common: pruritus, rash.

Severe cutaneous adverse reactions, including Stevens-Johnson syndrome and toxic epidermal necrolysis, have been reported very rarely. Added in CCDS version 9.0, March 2026.

Immune system disorders

Hypersensitivity reactions have been reported. Angioedema has not been observed in clinical studies.

Infections and infestations

Common: upper respiratory tract infection, nasopharyngitis.`,
  },
  {
    n: 9,
    title: "Pulmoxa — Prescribing Information",
    kind: "fda_label",
    activeSubstance: "pulmoxetine",
    version: "2026.1",
    effectiveDate: "2026-01-22",
    text: `PULMOXA (pulmoxetine) capsules, for oral use

1 INDICATIONS AND USAGE

PULMOXA is indicated to slow the decline in lung function in adults with idiopathic pulmonary fibrosis.

5 WARNINGS AND PRECAUTIONS

5.1 Elevated Liver Enzymes

Elevations in ALT and AST have been observed. Monitor liver tests before starting PULMOXA and periodically during treatment.

5.2 Interstitial Lung Disease

Interstitial lung disease has been reported in patients receiving PULMOXA. Monitor for new or worsening respiratory symptoms. Discontinue PULMOXA in patients with confirmed drug-induced interstitial lung disease.

6 ADVERSE REACTIONS

The most frequently reported adverse reactions were nausea, diarrhoea and cough.`,
  },
  {
    n: 10,
    title: "Pulmoxa Company Core Data Sheet v2.3",
    kind: "ccds",
    activeSubstance: "pulmoxetine",
    version: "2.3",
    effectiveDate: "2025-06-11",
    text: `PULMOXA COMPANY CORE DATA SHEET

Version 2.3. Confidential. For internal pharmacovigilance use only.

4.8 UNDESIRABLE EFFECTS

Respiratory, thoracic and mediastinal disorders

Cough and dyspnoea were reported commonly. No cases of interstitial lung disease were identified in the pooled safety population.

Gastrointestinal disorders

Very common: nausea. Common: diarrhoea, abdominal discomfort.

Hepatobiliary disorders

Common: transaminase elevation. Uncommon: hyperbilirubinaemia.`,
  },
  {
    /*
      No public label accompanies this one, and that is the point.
      NRV-114 is investigational, so no FDA label exists to be expected
      against — the honest answer on the public side is that no document is
      held, not that a document was read and said nothing. Adding a
      plausible-looking label here would manufacture the one thing an
      investigational product cannot have.
    */
    n: 11,
    title: "NRV-114 Investigator's Brochure v4.0",
    kind: "investigators_brochure",
    activeSubstance: "vastimab",
    version: "4.0",
    effectiveDate: "2026-04-08",
    text: `NRV-114 (vastimab) INVESTIGATOR'S BROCHURE

Edition 4.0. Confidential. For use by investigators and ethics committees only.

6.3 REFERENCE SAFETY INFORMATION

Infusion-related reactions were mild to moderate and comprised flushing and headache. No anaphylactic reactions have been observed to date.

Blood and lymphatic system disorders

Neutropenia was reported in 6.2% of subjects and was generally transient. Febrile neutropenia was reported in two subjects in the pooled trial population, both of whom recovered following interruption of study drug.

Nervous system disorders

Headache and paraesthesia were reported commonly. Uncommon: dizziness.

6.4 EXPECTEDNESS

Events listed in section 6.3 are considered expected for the purpose of expedited reporting from trial NRV-114-003.`,
  },
];

function build(spec: DocSpec): {
  document: SafetyDocument;
  chunks: readonly DocumentChunk[];
} {
  const id = DocumentId.parse(docId(spec.n));
  const sourceType: SourceType =
    spec.kind === "fda_label" ? "public" : "company";
  const chunks = chunkDocument(spec.text, { documentId: id, sourceType });

  const document = SafetyDocument.parse({
    id,
    title: spec.title,
    kind: spec.kind,
    sourceType,
    activeSubstance: spec.activeSubstance,
    version: spec.version,
    effectiveDate: spec.effectiveDate,
    objectKey: null,
    status: "chunking",
    rejectionReason: null,
    chunkCount: chunks.length,
    uploadedAt: "2026-06-01T09:00:00Z",
  });

  return { document, chunks };
}

const BUILT = SPECS.map(build);

export const SEED_DOCUMENTS: readonly SafetyDocument[] = BUILT.map(
  (b) => b.document,
);

export const SEED_CHUNKS: readonly DocumentChunk[] = BUILT.flatMap(
  (b) => b.chunks,
);

/** Brand and substance names the intake chat can recognise in free text. */
export const SEED_PRODUCTS: readonly string[] = [
  "Covaxil",
  "covaxilin",
  "Hepalex",
  "hepalexin",
  "Cardiquel",
  "cardiquelin",
  "Dermacil",
  "dermacilin",
  "Pulmoxa",
  "pulmoxetine",
  "NRV-114",
  "vastimab",
];

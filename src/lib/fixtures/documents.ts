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
];

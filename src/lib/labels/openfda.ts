/**
 * FDA labels, fetched from openFDA.
 *
 * The `public` half of the corpus was synthetic until now: two invented
 * products whose "Prescribing Information" I wrote by hand. The library screen
 * said "FDA labels, fetched from openFDA" the whole time, which was a claim
 * about provenance that nothing in the code supported — the same class of
 * fiction as a fixture marked `suggestedBy: "model"` for a model that never
 * ran. This module is what makes that sentence true.
 *
 * NO API KEY. openFDA is open; a key only raises the rate limit. So the
 * feature works on a fresh checkout with no setup at all, which is the same
 * reason the local vector store is the default.
 *
 * WHAT THIS IS NOT. It does not decide anything. It fetches a public document,
 * turns it into the same `SafetyDocument` + text pair an upload produces, and
 * hands it to the identical chunk → embed → mirror pipeline. Retrieval,
 * citation and the verbatim check cannot tell an openFDA label from an
 * uploaded PDF, and that is the point: one evidence path, one set of
 * guarantees.
 */
import { z } from "zod";
import { fetchJson, FetchJsonError } from "@/lib/fetch";
import { DocumentId, SafetyDocument } from "@/lib/schemas";

export const OPENFDA_BASE = "https://api.fda.gov/drug/label.json";

/**
 * Short, because a reporter is waiting at a form.
 *
 * A label that has not arrived in eight seconds is treated as absent, which
 * degrades to "no public label held" — an honest state the UI already renders.
 * Waiting longer would trade a truthful "we do not hold it" for a spinner.
 */
export const OPENFDA_TIMEOUT_MS = 8_000;

/**
 * The sections worth indexing, in the order a label prints them.
 *
 * Deliberately not everything. A label carries manufacturing detail, inactive
 * ingredients, storage, packaging and clinical pharmacology; none of it can
 * answer "is this reaction already described", and all of it would be
 * retrievable noise competing with the sections that can. The rule applied
 * here is: a section is in if a safety reviewer would read it to decide
 * listedness.
 *
 * Both label shapes are covered. Prescription labels use the numbered SPL
 * sections; over-the-counter labels use the Drug Facts headings
 * (`warnings`, `do_not_use`, `stop_use`), and a reporter is at least as likely
 * to be taking an OTC medicine.
 */
export const SAFETY_SECTIONS: readonly {
  readonly field: string;
  readonly heading: string;
}[] = [
  { field: "boxed_warning", heading: "BOXED WARNING" },
  { field: "contraindications", heading: "4 CONTRAINDICATIONS" },
  { field: "warnings_and_precautions", heading: "5 WARNINGS AND PRECAUTIONS" },
  { field: "warnings", heading: "WARNINGS" },
  { field: "adverse_reactions", heading: "6 ADVERSE REACTIONS" },
  { field: "drug_interactions", heading: "7 DRUG INTERACTIONS" },
  { field: "use_in_specific_populations", heading: "8 USE IN SPECIFIC POPULATIONS" },
  { field: "overdosage", heading: "10 OVERDOSAGE" },
  { field: "do_not_use", heading: "DO NOT USE" },
  { field: "when_using", heading: "WHEN USING THIS PRODUCT" },
  { field: "stop_use", heading: "STOP USE AND ASK A DOCTOR IF" },
  { field: "ask_doctor", heading: "ASK A DOCTOR BEFORE USE IF" },
  { field: "ask_doctor_or_pharmacist", heading: "ASK A DOCTOR OR PHARMACIST BEFORE USE IF" },
  { field: "pregnancy_or_breast_feeding", heading: "IF PREGNANT OR BREAST-FEEDING" },
];

/**
 * The response, narrowed to what is used.
 *
 * Every section is `string[]` in openFDA's schema and every one is optional —
 * an OTC label has none of the numbered sections and a prescription label has
 * none of the Drug Facts ones. `passthrough` is deliberate: the section fields
 * are read by name from a table rather than declared here, so the schema
 * validates the envelope and the table decides the content.
 */
const OpenFdaResult = z
  .object({
    effective_time: z.string().optional(),
    openfda: z
      .object({
        brand_name: z.array(z.string()).optional(),
        generic_name: z.array(z.string()).optional(),
        substance_name: z.array(z.string()).optional(),
        manufacturer_name: z.array(z.string()).optional(),
        product_type: z.array(z.string()).optional(),
        spl_set_id: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .loose();

const OpenFdaResponse = z.object({
  results: z.array(OpenFdaResult).min(1),
});

export interface FetchedLabel {
  readonly document: SafetyDocument;
  /** Assembled section text, ready for `chunkDocument`. */
  readonly text: string;
}

export type LabelOutcome =
  | { readonly status: "found"; readonly label: FetchedLabel }
  /** openFDA answered, and holds no label for this name. Not an error. */
  | { readonly status: "not_found"; readonly reason: string }
  /** openFDA could not be reached, or answered something unusable. */
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * Break openFDA's run-on section text into lines the chunker can read.
 *
 * THE PROBLEM THIS SOLVES, because it is not obvious. openFDA returns each
 * section as a single string with the newlines stripped:
 *
 *   "6 ADVERSE REACTIONS The following important adverse reactions are …"
 *
 * `chunkDocument` walks line by line and treats a line starting with a section
 * number as a heading. Handed that string it would classify all eight thousand
 * characters as one heading, truncate it to the 300-character section cap, and
 * emit no body at all — the entire adverse-reactions section would vanish from
 * the corpus with nothing reporting a failure.
 *
 * So a newline is inserted before each SPL section marker. Only line breaks are
 * added; not a character of the label's own wording is altered, removed or
 * reordered. That is the same standing this text has as pdf.js output from an
 * uploaded PDF: an extracted representation, which is what gets mirrored, cited
 * and checked verbatim. The guarantee the project makes is between a model's
 * quotation and the stored chunk, and that guarantee is untouched.
 */
export function splitSectionMarkers(
  text: string,
  sectionNumber: string | null,
): string {
  let out = text;

  /*
    Only subsections OF THIS SECTION are treated as headings, and that
    constraint is load-bearing rather than tidy.

    A naive `\d+\.\d+\s+[A-Z]` matches the incidence tables that fill an
    adverse-reactions section, because openFDA flattens them into the same run
    of text: "… 3.0 Pharyngolaryngeal pain 2.1 3.9 1.6 2.8 0.7 …" is a table
    row, and splitting there produced the section path
    "6 ADVERSE REACTIONS › 3.0 Pharyngolaryngeal pain 2.1 3.9 1.6 2.8 0.7"
    printed under a reviewer's citation as if it were where the passage lived.

    Inside `adverse_reactions` the only real subsections are 6.x. Requiring the
    number to descend from the section being assembled rejects every table row
    whose leading figure happens to look like a section number, without any
    guessing about what the following words mean.
  */
  if (sectionNumber !== null) {
    const escaped = sectionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    /*
      A heading's title must be WORDS, and a sentence must follow it.

      Requiring the parent number alone was not enough. "6.8 Pain in extremity
      5.9 8.5 3.7 9.3 3.1" is a row of an incidence table inside section 6, so
      it descends from the right section and still is not a heading — it became
      the section path "6 ADVERSE REACTIONS › 6.8 Pain in extremity 5.9 8.5 3.7
      9.3 3.1" under a citation.

      What separates them is what comes after the number. A real subsection
      reads "6.1 Clinical Trials Experience The following…": alphabetic words,
      then a capital starting a sentence. A table row reads "6.8 Pain in
      extremity 5.9…": alphabetic words, then a figure. Barring digits from the
      title and demanding a sentence after it keeps the first and rejects the
      second, without guessing at meaning.

      The newline goes on BOTH sides, so the heading is a line of its own and
      the body that follows is not swallowed into it.
    */
    out = out.replace(
      new RegExp(
        `\\s+(${escaped}\\.\\d+(?:\\.\\d+)*\\s+[A-Z][A-Za-z'’-]*(?:\\s+[A-Za-z'’-]+){0,6})\\s+(?=[A-Z])`,
        "g",
      ),
      "\n$1\n",
    );
  }

  // A leading "6 ADVERSE REACTIONS" run of capitals, closed by the first word
  // that is not shouting. Anchored, so it fires at most once and can never
  // break a sentence in the body.
  out = out.replace(
    /^(\d+(?:\.\d+)*\s+[A-Z][A-Z0-9 ,&'()\/-]{2,70}?)\s+(?=[A-Z][a-z]|\()/,
    "$1\n",
  );

  return out.trim();
}

/** The leading SPL section number of a heading, e.g. "6" from "6 ADVERSE REACTIONS". */
function sectionNumberOf(heading: string): string | null {
  return /^(\d+(?:\.\d+)*)\s/.exec(heading)?.[1] ?? null;
}

/** True when the body already opens with this heading, so ours would double it. */
function bodyRepeatsHeading(body: string, heading: string): boolean {
  const firstLine = (body.split("\n", 1)[0] ?? "").trim().toLowerCase();
  /*
    Equality only, never "starts with".

    Sertraline's boxed warning arrives as one run-on line beginning "BOXED
    WARNING Suicidality and Antidepressant Drugs Antidepressants increased…".
    A prefix test called that a repeat and suppressed our heading — but the
    body's own line is not a heading the chunker can read (no leading section
    number), so the passage ended up with no section path at all. The heading
    is only redundant when the body genuinely carries it alone on a line.
  */
  return firstLine === heading.trim().toLowerCase();
}

/** First non-empty entry of an openFDA array field. */
function first(values: readonly string[] | undefined): string | null {
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/** openFDA dates are `YYYYMMDD`; `IsoDate` wants `YYYY-MM-DD`. */
function isoDate(effectiveTime: string | undefined): string | null {
  if (effectiveTime === undefined) return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(effectiveTime.trim());
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Assemble the safety sections into one document text.
 *
 * Each section gets its heading on its own line so `chunkDocument` records a
 * real section path, which is what the citation renders under the quote — a
 * reviewer reading "6.1 Clinical Trials Experience" beneath a passage knows
 * where in the label it sat.
 */
export function assembleLabelText(result: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const { field, heading } of SAFETY_SECTIONS) {
    const raw = result[field];
    if (!Array.isArray(raw)) continue;

    const body = raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => splitSectionMarkers(entry, sectionNumberOf(heading)))
      .filter((entry) => entry.length > 0)
      .join("\n\n");
    if (body.length === 0) continue;

    /*
      The label's own heading wins where it has one.

      openFDA's `adverse_reactions` usually opens with "6 ADVERSE REACTIONS",
      which `splitSectionMarkers` has already put on its own line. Emitting
      ours as well doubled it inside the chunk text — and chunk text is what a
      reviewer reads under the quote, so the duplication was visible rather
      than merely wasteful. Ours is emitted only when the body has no heading
      of its own, which is the OTC case: Drug Facts sections carry no headings
      in the data at all.
    */
    parts.push(bodyRepeatsHeading(body, heading) ? body : `${heading}\n\n${body}`);
  }

  return parts.join("\n\n");
}

/**
 * A stable document id, so re-fetching a label replaces it rather than
 * duplicating it.
 *
 * `spl_set_id` is already a GUID and is FDA's own identifier for "this label,
 * across all its versions" — exactly the identity we want. Using it directly
 * means the library file for a label is the same file every time, and a
 * citation's document id traces back to a public FDA record.
 */
function documentIdFor(splSetId: string | null): DocumentId | null {
  if (splSetId === null) return null;
  const parsed = DocumentId.safeParse(splSetId.toLowerCase());
  return parsed.success ? parsed.data : null;
}

export interface FetchLabelOptions {
  /** Overridable so a test can point at a stub. */
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Optional. openFDA needs no key; one only raises the rate limit. */
  readonly apiKey?: string | null | undefined;
}

/**
 * Escape a value for an openFDA search term.
 *
 * The query goes into a Lucene-style `search=` parameter, so a stray quote or
 * a bare `AND` from a reporter's text would change the shape of the query
 * rather than be searched for. Only letters, digits, spaces and hyphens
 * survive — a drug name needs nothing else, and everything that could alter
 * the query is gone before it is built rather than escaped inside it.
 */
export function sanitiseDrugName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Fetch the public label for a drug name. Never throws.
 *
 * Brand and generic are both tried because a reporter types whichever is on
 * the box, and openFDA indexes them separately. Prescription labels are
 * preferred over OTC only in the sense that the query does not filter by type
 * — the first result for the name is taken, which is FDA's own relevance
 * order.
 */
export async function fetchLabel(
  drugName: string,
  options: FetchLabelOptions = {},
): Promise<LabelOutcome> {
  const name = sanitiseDrugName(drugName);
  if (name.length < 3) {
    return { status: "not_found", reason: "no medicine name was given" };
  }

  const base = options.baseUrl ?? OPENFDA_BASE;
  const search = `(openfda.brand_name:"${name}"+OR+openfda.generic_name:"${name}"+OR+openfda.substance_name:"${name}")`;
  const key = options.apiKey ? `&api_key=${encodeURIComponent(options.apiKey)}` : "";
  /*
    Five results, not one, because the first is not always usable.

    A name like "lisinopril" matches hundreds of labels from different
    repackagers, and some carry no SPL set id or no safety sections at all —
    "lisinopril" failed outright against limit=1 for exactly that reason. The
    first *usable* record is taken, preserving FDA's own relevance order while
    stepping over records that cannot be stored or have nothing to say.
  */
  const url = `${base}?search=${search}&limit=5${key}`;

  let response;
  try {
    response = await fetchJson(url, OpenFdaResponse, {
      method: "GET",
      signal: AbortSignal.timeout(options.timeoutMs ?? OPENFDA_TIMEOUT_MS),
    });
  } catch (cause) {
    /*
      A 404 from openFDA means "no label matches", not "the service failed".
      Collapsing the two would tell a reporter the FDA could not be reached
      when in fact it answered clearly — the same distinction between
      `no_result` and `source_unavailable` that the evidence panel draws.
    */
    if (cause instanceof FetchJsonError && cause.kind === "http") {
      const status = (cause as { status?: number }).status;
      if (status === 404) {
        return {
          status: "not_found",
          reason: `openFDA holds no label for "${name}"`,
        };
      }
    }
    return {
      status: "unavailable",
      reason:
        cause instanceof FetchJsonError
          ? `openFDA could not be reached (${cause.kind})`
          : "openFDA could not be reached",
    };
  }

  let chosen: {
    result: (typeof response.results)[number];
    documentId: DocumentId;
    text: string;
  } | null = null;

  for (const candidate of response.results) {
    const id = documentIdFor(first(candidate.openfda?.spl_set_id));
    if (id === null) continue;
    const body = assembleLabelText(candidate as unknown as Record<string, unknown>);
    if (body.trim().length === 0) continue;
    chosen = { result: candidate, documentId: id, text: body };
    break;
  }

  if (chosen === null) {
    return {
      status: "not_found",
      reason: `openFDA holds a record for "${name}" but none with usable safety sections`,
    };
  }

  const { result, documentId, text } = chosen;
  const meta = result.openfda ?? {};

  /*
    activeSubstance drives `documentGovernsDrug`, which is the wrong-product
    guarantee. Generic name first because it is the cleanest form FDA
    publishes — "atorvastatin calcium" rather than the substance record's
    "ATORVASTATIN CALCIUM TRIHYDRATE" — and because scope matching does a
    prefix comparison, so the shorter, more canonical form matches more of what
    a reporter might type.
  */
  const substance =
    first(meta.generic_name) ?? first(meta.substance_name) ?? name;
  const brand = first(meta.brand_name) ?? substance;

  const parsed = SafetyDocument.safeParse({
    id: documentId,
    // The brand is in the title because scope also matches on title words.
    title: `${brand} — FDA Prescribing Information`,
    kind: "fda_label",
    sourceType: "public",
    activeSubstance: substance.toLowerCase(),
    version: first(meta.spl_set_id) === null ? null : `SPL ${isoDate(result.effective_time) ?? "unversioned"}`,
    effectiveDate: isoDate(result.effective_time),
    // No R2 object: openFDA is the origin and re-fetchable by set id, so
    // storing bytes would duplicate a public record rather than preserve one.
    objectKey: null,
    status: "chunking",
    rejectionReason: null,
    chunkCount: 0,
    uploadedAt: new Date().toISOString(),
  });

  if (!parsed.success) {
    return {
      status: "unavailable",
      reason: "the label did not match the document schema",
    };
  }

  return { status: "found", label: { document: parsed.data, text } };
}

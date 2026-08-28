/**
 * Turning a model's reply about a report into fields, or refusing it.
 *
 * The rule that carries the weight is the same one the assessment uses: a
 * phrase the model offers as evidence must occur in the submitted text
 * character-for-character, checked here rather than asked for in the prompt.
 * A seriousness criterion is what starts a 15-day regulatory clock, and a
 * criterion raised on a phrase the reporter never wrote is a flag with no
 * evidence behind it.
 *
 * Everything else is coerced conservatively: a value the model offers that is
 * not one of the enum members this domain uses is dropped rather than guessed
 * at. A dropped field leaves a gap the reviewer can see and fill. A guessed
 * one looks exactly like a fact.
 */
import { z } from "zod";
import { SERIOUSNESS_CRITERIA, type SeriousnessCriterion } from "@/lib/schemas";
import {
  Extraction,
  RawExtraction,
  type SeriousnessEvidence,
} from "./schema";

export interface ExtractRejection {
  readonly kind: "not_json" | "wrong_shape" | "phrase_not_verbatim";
  readonly detail: string;
}

export type ExtractResult =
  | { readonly ok: true; readonly extraction: Extraction }
  | { readonly ok: false; readonly rejection: ExtractRejection };

/** Same fence-peel policy as the assessment: unwrap, never scan for a brace. */
export function unwrapFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
}

export function parseExtraction(
  text: string,
):
  | { readonly ok: true; readonly raw: RawExtraction }
  | { readonly ok: false; readonly rejection: ExtractRejection } {
  let json: unknown;
  try {
    json = JSON.parse(unwrapFence(text)) as unknown;
  } catch {
    return {
      ok: false,
      rejection: { kind: "not_json", detail: "the reply was not a JSON object" },
    };
  }
  const parsed = RawExtraction.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        kind: "wrong_shape",
        detail: `the JSON did not match the required shape (${z
          .prettifyError(parsed.error)
          .replace(/\s+/g, " ")
          .slice(0, 200)})`,
      },
    };
  }
  return { ok: true, raw: parsed.data };
}

/** Only values this domain actually has. Anything else becomes null. */
function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | null,
): T | null {
  if (value === null) return null;
  const normalised = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.find((a) => a === normalised) ?? null;
}

const ROUTES = [
  "oral",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "topical",
  "inhalation",
  "other",
  "unknown",
] as const;

const OUTCOMES = [
  "recovered",
  "recovering",
  "not_recovered",
  "recovered_with_sequelae",
  "fatal",
  "unknown",
] as const;

const SEXES = ["male", "female", "unknown"] as const;

/** A date the model offers, kept only if it is a plain ISO calendar date. */
function isoDateOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(trimmed) ? trimmed : null;
}

function boundedAge(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const age = Math.trunc(value);
  return age >= 0 && age <= 130 ? age : null;
}

export interface VerifyExtractionInput {
  readonly raw: RawExtraction;
  /** Exactly the text that was submitted. Phrases are checked against this. */
  readonly sourceText: string;
  readonly model: string;
  readonly gatewayRequestId: string | null;
  readonly now: string;
}

/**
 * Resolve the seriousness criteria the model raised.
 *
 * A criterion is kept only when its phrase occurs verbatim in the submitted
 * text. Offsets are recorded from that lookup, so the highlight the reviewer
 * sees is computed from the same match that authorised the flag rather than
 * re-searched later and possibly landing on a different occurrence.
 *
 * A phrase that does not occur is not merely dropped — it fails the whole
 * extraction. A model inventing the words a patient used is not a model whose
 * other fields should be trusted on the same reply.
 */
function resolveSeriousness(
  raw: RawExtraction,
  sourceText: string,
): { readonly ok: true; readonly found: SeriousnessEvidence[] } | { readonly ok: false; readonly detail: string } {
  const found: SeriousnessEvidence[] = [];
  const seen = new Set<SeriousnessCriterion>();

  for (const entry of raw.seriousness) {
    const criterion = oneOf(SERIOUSNESS_CRITERIA, entry.criterion);
    // An unrecognised criterion name is dropped: the six are fixed by
    // regulation and there is no seventh for a model to invent.
    if (criterion === null || seen.has(criterion)) continue;

    const phrase = entry.phrase.trim();
    if (phrase.length === 0) {
      return { ok: false, detail: `the phrase for ${criterion} was empty` };
    }

    const start = sourceText.indexOf(phrase);
    if (start < 0) {
      return {
        ok: false,
        detail: `the phrase ${JSON.stringify(phrase.slice(0, 60))} does not occur in the report`,
      };
    }

    seen.add(criterion);
    found.push({ criterion, phrase, start, end: start + phrase.length });
  }

  return { ok: true, found };
}

/**
 * A value the model reports is kept only if the reporter actually wrote it.
 *
 * THE FABRICATION THIS STOPS, which happened to a real report. A reporter
 * wrote "after i had my coronovirus injection i feel dizzy". The extraction
 * prompt lists the products this library holds, and the model answered
 * `suspectDrug: "Covaxil"` — a demo product the reporter had never mentioned,
 * picked presumably for sounding like the words that were there. The case was
 * filed under it, attributing a coronavirus-vaccine report to an unrelated
 * medicine.
 *
 * `suspectDrug` was the one model-written field with no grounding check at
 * all. Seriousness phrases are already required to occur verbatim in the
 * reporter's text, and a quoted span is required to occur verbatim in the
 * chunk it cites — this is the same rule applied to the field that decides
 * which product the whole case is about, which is the field where inventing
 * one does the most damage.
 *
 * Case and surrounding whitespace are normalised, because a model rewriting
 * "covaxil" as "Covaxil" is reporting the reporter's own word back. Nothing
 * else is: the value must appear in what the person wrote.
 */
function groundedIn(value: string | null, sourceText: string): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const haystack = sourceText.toLowerCase().replace(/\s+/g, " ");
  return haystack.includes(trimmed.toLowerCase().replace(/\s+/g, " "))
    ? trimmed
    : null;
}

export function verifyExtraction(input: VerifyExtractionInput): ExtractResult {
  const { raw, sourceText, model, gatewayRequestId, now } = input;

  const seriousness = resolveSeriousness(raw, sourceText);
  if (!seriousness.ok) {
    return {
      ok: false,
      rejection: { kind: "phrase_not_verbatim", detail: seriousness.detail },
    };
  }

  const candidate = {
    // Both are checked against the reporter's own words. A drug or a reaction
    // the person never wrote is a fabrication, however plausible it reads.
    suspectDrug: groundedIn(raw.suspectDrug ?? null, sourceText),
    reaction: groundedIn(raw.reaction ?? null, sourceText),
    dose: raw.dose?.trim() || null,
    route: oneOf(ROUTES, raw.route),
    patientAgeYears: boundedAge(raw.patientAgeYears),
    patientSex: oneOf(SEXES, raw.patientSex),
    therapyStart: isoDateOrNull(raw.therapyStart),
    therapyEnd: isoDateOrNull(raw.therapyEnd),
    reactionOnset: isoDateOrNull(raw.reactionOnset),
    outcome: oneOf(OUTCOMES, raw.outcome),
    seriousness: seriousness.found,
    model,
    gatewayRequestId,
    generatedAt: now,
  };

  // Parsed rather than asserted, so the schema is a real backstop and not a
  // comment — the mistake the assessment path made and had to be corrected on.
  const parsed = Extraction.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        kind: "wrong_shape",
        detail: `the extraction failed its own schema (${z
          .prettifyError(parsed.error)
          .replace(/\s+/g, " ")
          .slice(0, 160)})`,
      },
    };
  }
  return { ok: true, extraction: parsed.data };
}

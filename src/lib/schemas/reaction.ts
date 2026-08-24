/**
 * Reaction and SeriousnessFlags.
 *
 * The reaction is the fourth minimum validity criterion — "an event". The
 * seriousness flags on it are what start the 15-day clock, so this is the file
 * where a wrong shape has a regulatory consequence rather than a cosmetic one.
 */
import { z } from "zod";
import { NarrativeSpan, Provenance, ReactionId, IsoDate } from "./primitives";

// ---------------------------------------------------------------------------
// The six seriousness criteria
// ---------------------------------------------------------------------------

/**
 * The six, in the order regulators list them and the order the UI must show
 * them. Exported as a const tuple so a screen can iterate without inventing
 * its own ordering, and so adding a seventh is a compile error everywhere it
 * matters rather than a silently missing row.
 */
export const SERIOUSNESS_CRITERIA = [
  "death",
  "life_threatening",
  "hospitalisation",
  "persistent_disability",
  "congenital_anomaly",
  "other_medically_important",
] as const;

export const SeriousnessCriterion = z.enum(SERIOUSNESS_CRITERIA);
export type SeriousnessCriterion = z.output<typeof SeriousnessCriterion>;

/** Canonical wording. Defined once so no screen paraphrases a legal term. */
export const SERIOUSNESS_LABELS: Readonly<
  Record<SeriousnessCriterion, string>
> = {
  death: "Death",
  life_threatening: "Life-threatening",
  hospitalisation: "Hospitalisation",
  persistent_disability: "Persistent or significant disability",
  congenital_anomaly: "Congenital anomaly or birth defect",
  other_medically_important: "Other medically important condition",
};

/**
 * A single raised flag.
 *
 * `trigger` is required, not nullable. CLAUDE.md says the app highlights the
 * exact phrase that triggered each flag, so a flag with no phrase behind it is
 * not a thing this system can represent. That is deliberate: it makes an
 * unevidenced seriousness flag unconstructible rather than merely discouraged.
 */
export const SeriousnessAssertion = z.object({
  trigger: NarrativeSpan,
  suggestedBy: Provenance,
  confirmedByReviewer: z.boolean(),
  rejectedByReviewer: z.boolean(),
});
export type SeriousnessAssertion = z.output<typeof SeriousnessAssertion>;

/**
 * Hospitalisation carries one extra fact the other five do not: CLAUDE.md
 * spells it "hospitalisation (initial or prolonged)", and the two are
 * genuinely different events. Keeping the distinction here rather than
 * flattening it means the reviewer sees which one was reported.
 */
export const HospitalisationAssertion = SeriousnessAssertion.extend({
  kind: z.enum(["initial", "prolonged"]),
});
export type HospitalisationAssertion = z.output<
  typeof HospitalisationAssertion
>;

/**
 * All six, always present as keys, each either null or an evidenced assertion.
 *
 * Written out longhand rather than as a record type on purpose. A reviewer
 * opening this file should see the six criteria by name — CLAUDE.md says
 * getting the vocabulary right is half the demo, and a `Record<Criterion, T>`
 * hides the vocabulary behind a generic.
 */
export const SeriousnessFlags = z.object({
  death: SeriousnessAssertion.nullable(),
  life_threatening: SeriousnessAssertion.nullable(),
  hospitalisation: HospitalisationAssertion.nullable(),
  persistent_disability: SeriousnessAssertion.nullable(),
  congenital_anomaly: SeriousnessAssertion.nullable(),
  other_medically_important: SeriousnessAssertion.nullable(),
});
export type SeriousnessFlags = z.output<typeof SeriousnessFlags>;

/** Every flag null. The starting point for a freshly received report. */
export const NO_SERIOUSNESS_FLAGS: SeriousnessFlags = {
  death: null,
  life_threatening: null,
  hospitalisation: null,
  persistent_disability: null,
  congenital_anomaly: null,
  other_medically_important: null,
};

/**
 * Which criteria are raised, in canonical order.
 *
 * Note this counts a flag whether or not a reviewer has confirmed it, because
 * the queue has to surface a *possibly* serious case immediately — waiting for
 * confirmation before showing it would defeat the point of the clock. Callers
 * that need only confirmed flags filter on `confirmedByReviewer`.
 */
export function flaggedCriteria(
  flags: SeriousnessFlags,
): readonly SeriousnessCriterion[] {
  return SERIOUSNESS_CRITERIA.filter((c) => flags[c] !== null);
}

/** Serious means any one of the six is raised. Any one is enough. */
export function isSerious(flags: SeriousnessFlags): boolean {
  return flaggedCriteria(flags).length > 0;
}

/** Serious on the strength of flags a human has actually signed off. */
export function isConfirmedSerious(flags: SeriousnessFlags): boolean {
  return SERIOUSNESS_CRITERIA.some((c) => {
    const assertion = flags[c];
    return assertion !== null && assertion.confirmedByReviewer;
  });
}

// ---------------------------------------------------------------------------
// Reaction
// ---------------------------------------------------------------------------

/** How the event resolved, in the vocabulary the regulator expects. */
export const ReactionOutcome = z.enum([
  "recovered",
  "recovering",
  "not_recovered",
  "recovered_with_sequelae",
  "fatal",
  "unknown",
]);
export type ReactionOutcome = z.output<typeof ReactionOutcome>;

export const Reaction = z.object({
  id: ReactionId,
  /**
   * The reporter's own words — "my legs swelled up". Never overwritten, because
   * the verbatim term is what the regulator receives and what a later reviewer
   * needs in order to second-guess the coding.
   */
  verbatimTerm: z.string().min(1).max(400),
  /**
   * The coded MedDRA Preferred Term, once someone has mapped it. Null until
   * then, and mapping is a human act — the model may propose, as everywhere.
   */
  meddraPreferredTerm: z.string().min(1).max(200).nullable(),
  onset: IsoDate.nullable(),
  outcome: ReactionOutcome,
  seriousness: SeriousnessFlags,
});
export type Reaction = z.output<typeof Reaction>;

/** A case is serious if any of its reactions is. */
export function anyReactionSerious(reactions: readonly Reaction[]): boolean {
  return reactions.some((r) => isSerious(r.seriousness));
}

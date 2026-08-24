/**
 * Reaction and SeriousnessFlags.
 *
 * The reaction is the fourth minimum validity criterion — "an event". The
 * seriousness flags on it are what start the 15-day clock, so this is the file
 * where a wrong shape has a regulatory consequence rather than a cosmetic one.
 */
import { z } from "zod";
import { NarrativeSpan, ReactionId, IsoDate } from "./primitives";

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
 * How a flag came to be raised.
 *
 * `narrative` — read out of the case narrative, and therefore carrying the
 * exact phrase. CLAUDE.md says the app highlights the phrase that triggered
 * each flag, and this is the case that promise is about.
 *
 * `declared` — asserted outright, with no phrase to point at. A public
 * reporter ticking "they went into hospital" is a declaration, not an
 * extraction: there are no character offsets in a checkbox. Step 5 deferred
 * this and the seeded fixtures force the answer, because a case that arrived
 * through the public form genuinely has flags of this kind.
 *
 * Keeping both in one shape rather than a discriminated union is a trade: the
 * compiler no longer narrows `trigger` for free, but hospitalisation can still
 * extend the shape, and the refinement below makes a narrative flag without
 * its phrase unconstructible at runtime — which was the guarantee worth
 * having.
 */
export const SeriousnessBasis = z.enum(["narrative", "declared"]);
export type SeriousnessBasis = z.output<typeof SeriousnessBasis>;

/** Who put the flag there. A reporter can only ever declare. */
export const AssertedBy = z.enum(["model", "reporter", "reviewer"]);
export type AssertedBy = z.output<typeof AssertedBy>;

const assertionShape = {
  basis: SeriousnessBasis,
  /** The exact words. Required when basis is `narrative`, null when declared. */
  trigger: NarrativeSpan.nullable(),
  assertedBy: AssertedBy,
  confirmedByReviewer: z.boolean(),
  rejectedByReviewer: z.boolean(),
};

/**
 * A narrative flag must carry its phrase; a declared one must not pretend to.
 * Both halves matter — a declared flag with a span would be inventing evidence.
 */
function evidenceMatchesBasis(assertion: {
  readonly basis: SeriousnessBasis;
  readonly trigger: NarrativeSpan | null;
}): boolean {
  return (assertion.basis === "narrative") === (assertion.trigger !== null);
}

const EVIDENCE_RULE = {
  message:
    "A narrative-derived flag must carry the phrase it was read from, and a declared one must not claim a phrase it does not have",
  path: ["trigger"],
};

export const SeriousnessAssertion = z
  .object(assertionShape)
  .refine(evidenceMatchesBasis, EVIDENCE_RULE);
export type SeriousnessAssertion = z.output<typeof SeriousnessAssertion>;

/**
 * Hospitalisation carries one extra fact the other five do not: CLAUDE.md
 * spells it "hospitalisation (initial or prolonged)", and the two are
 * genuinely different events. Keeping the distinction here rather than
 * flattening it means the reviewer sees which one was reported.
 */
export const HospitalisationAssertion = z
  .object({ ...assertionShape, kind: z.enum(["initial", "prolonged"]) })
  .refine(evidenceMatchesBasis, EVIDENCE_RULE);
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

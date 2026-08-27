/**
 * Turn a completed conversation into a Case the reviewer queue can show.
 *
 * This is the bridge step 5 deferred and step 8 built the schema for.
 *
 * It produces BOTH bases now, and the header used to say otherwise — it
 * claimed every flag here was `declared`, which stopped being true the moment
 * intake extraction landed. A reporter answering "yes, they went into
 * hospital" has declared it and there is no character span in an answer to a
 * direct question. A criterion a model read out of the narrative carries the
 * exact words that carried it, so it is a `narrative` flag with a span the
 * case screen highlights. The schema refuses to let a declared flag claim a
 * phrase it does not have, so neither kind can quietly invent evidence.
 */
import {
  Case,
  CaseId,
  CaseReference,
  DrugId,
  NO_SERIOUSNESS_FLAGS,
  ReactionId,
  type IsoDate,
  type Reaction,
  type ReactionOutcome,
  type SeriousnessFlags,
  type SuspectDrug,
} from "@/lib/schemas";
import { parsePartialDate, type PartialDate } from "@/lib/schemas/partial-date";
import type { IntakeSlots } from "./conversation";

export interface IntakeCaseInput {
  readonly slots: IntakeSlots;
  readonly reference: CaseReference;
  readonly receivedAt: IsoDate;
  readonly now: string;
  /** Injected so the result is reproducible in a test. */
  readonly ids: {
    readonly caseId: string;
    readonly drugId: string;
    readonly reactionId: string;
  };
}

/**
 * Build the six flags from what the conversation collected.
 *
 * Two bases, and the difference is evidence. A reporter answering "yes, they
 * went into hospital" has *declared* it: there are no character offsets in an
 * answer to a direct question, and the schema refuses to let a declared flag
 * claim a phrase it does not have. A criterion a model read out of the
 * narrative carries the exact words that carried it, so it is a `narrative`
 * flag with a span the case screen highlights.
 *
 * Until now nothing in this codebase produced a narrative flag at runtime —
 * `basis: "narrative"` existed only in fixtures, so `HighlightedNarrative`
 * never fired on a real case. This is the function that fills it.
 *
 * A criterion the model read AND the reporter declared is recorded as
 * narrative, because the phrase is strictly more information than the
 * declaration. Where they disagree nothing is dropped: the union is kept, and
 * a reviewer strikes down whichever is wrong.
 */
function seriousnessFlags(slots: IntakeSlots, narrative: string): SeriousnessFlags {
  const flags: Record<string, unknown> = { ...NO_SERIOUSNESS_FLAGS };

  const declare = (criterion: string, extra: object) => {
    flags[criterion] =
      criterion === "hospitalisation" ? { ...extra, kind: "initial" } : extra;
  };

  for (const criterion of slots.seriousness ?? []) {
    declare(criterion, {
      basis: "declared" as const,
      trigger: null,
      assertedBy: "reporter" as const,
      confirmedByReviewer: false,
      rejectedByReviewer: false,
    });
  }

  for (const evidence of slots.seriousnessEvidence) {
    /*
      Who gets the credit when both said it.

      `declare` overwrites, so a criterion the reporter declared AND the model
      read was being re-stamped `assertedBy: "model"` — losing the fact that
      the reporter said it themselves. The phrase is still worth keeping (it is
      strictly more information than a bare declaration), but the reporter
      asserted the flag and the record has to keep saying so.
    */
    const declaredByReporter = (slots.seriousness ?? []).includes(
      evidence.criterion,
    );
    /*
      The offsets were computed against the text the model was given. They are
      only usable if that text is the narrative that will actually be stored —
      the model may have read a later message, and a span pointing into a
      different string would highlight the wrong words or, worse, the right
      words in the wrong place. Re-check rather than trust, and fall back to a
      declared flag when the phrase is not in the stored narrative.
    */
      const usable =
        narrative.slice(evidence.start, evidence.end) === evidence.phrase;
      declare(
        evidence.criterion,
        usable
          ? {
              basis: "narrative" as const,
              trigger: {
                quote: evidence.phrase,
                start: evidence.start,
                end: evidence.end,
              },
              assertedBy: declaredByReporter
                ? ("reporter" as const)
                : ("model" as const),
              confirmedByReviewer: false,
              rejectedByReviewer: false,
            }
          : {
              basis: "declared" as const,
              trigger: null,
              assertedBy: declaredByReporter
                ? ("reporter" as const)
                : ("model" as const),
              confirmedByReviewer: false,
              rejectedByReviewer: false,
            },
      );
  }

  return flags as SeriousnessFlags;
}

/** An email if it looks like one, otherwise treat it as a phone number. */
function splitContact(contact: string | null): {
  email: string | null;
  phone: string | null;
} {
  if (contact === null) return { email: null, phone: null };
  const trimmed = contact.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)
    ? { email: trimmed, phone: null }
    : { email: null, phone: trimmed };
}

/**
 * The model's strings, narrowed to the domain's own vocabulary.
 *
 * verify.ts has already rejected anything outside these enums, so these are
 * belt-and-braces against a slot filled by some future path. Unknown becomes
 * null rather than a default: a gap a reviewer can see beats a guess that
 * reads like a fact.
 */
function routeOrNull(value: string | null): SuspectDrug["route"] {
  const routes = [
    "oral",
    "intravenous",
    "intramuscular",
    "subcutaneous",
    "topical",
    "inhalation",
    "other",
    "unknown",
  ] as const;
  return routes.find((r) => r === value) ?? null;
}

function outcomeOrUnknown(value: string | null): ReactionOutcome {
  const outcomes = [
    "recovered",
    "recovering",
    "not_recovered",
    "recovered_with_sequelae",
    "fatal",
    "unknown",
  ] as const;
  return outcomes.find((o) => o === value) ?? "unknown";
}

/**
 * An ISO date the model offered, as the PartialDate the domain stores.
 *
 * Delegated to `parsePartialDate`, which already validates the calendar (it
 * rejects the 30th of February and gets leap years right) and derives the
 * precision. A second date parser here would be a second thing to keep correct.
 */
function partialDateOrNull(value: string | null): PartialDate | null {
  return value === null ? null : parsePartialDate(value);
}

export function intakeToCase(input: IntakeCaseInput): Case {
  const { slots, ids } = input;
  const contact = splitContact(slots.reporterContact);

  const narrative = slots.narrative ?? "";

  const drug: SuspectDrug = {
    id: DrugId.parse(ids.drugId),
    reportedName: slots.drug ?? "Not stated",
    activeSubstance: null,
    role: "suspect",
    // A public reporter cannot know this, and guessing would route the case at
    // the wrong company document. A reviewer sets it during triage.
    marketingStatus: "marketed",
    // Model-read fields. Null on the fallback path, and null is a normal
    // value here — a reporter who did not mention a dose has not made an error.
    dose: slots.dose,
    route: routeOrNull(slots.route),
    indication: null,
    therapyStart: partialDateOrNull(slots.therapyStart),
    therapyEnd: partialDateOrNull(slots.therapyEnd),
    dechallenge: null,
    rechallenge: null,
  };

  const reaction: Reaction = {
    id: ReactionId.parse(ids.reactionId),
    verbatimTerm: slots.reaction ?? "Not stated",
    // Coding stays a human act. The model may propose elsewhere; it does not
    // write a MedDRA term into the record.
    meddraPreferredTerm: null,
    onset: partialDateOrNull(slots.reactionOnset),
    outcome: outcomeOrUnknown(slots.outcome),
    seriousness: seriousnessFlags(slots, narrative),
  };

  return Case.parse({
    id: CaseId.parse(ids.caseId),
    reference: input.reference,
    origin: "public_form",
    receivedAt: input.receivedAt,
    patient: {
      initials: null,
      ageYears: slots.age,
      ageGroup: null,
      sex: slots.sex,
      dateOfBirth: null,
      weightKg: null,
      localIdentifier: null,
    },
    reporter: {
      name: slots.reporterName,
      organisation: null,
      country: null,
      qualification: null,
      email: contact.email,
      phone: contact.phone,
      contactPermitted: true,
    },
    drugs: [drug],
    reactions: [reaction],
    narrative,
    status: "received",
    assignedTo: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

/**
 * Turn a completed conversation into a Case the reviewer queue can show.
 *
 * This is the bridge step 5 deferred and step 8 built the schema for. The
 * seriousness flags produced here are `declared`, not `narrative`: the
 * reporter said "he went into hospital", and there is no character span in a
 * spoken answer to point at. The schema refuses to let a declared flag claim a
 * phrase it does not have, so this cannot quietly invent evidence even if
 * someone later edits it carelessly.
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
  type SeriousnessFlags,
  type SuspectDrug,
} from "@/lib/schemas";
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

function declaredFlags(slots: IntakeSlots): SeriousnessFlags {
  const flags: Record<string, unknown> = { ...NO_SERIOUSNESS_FLAGS };
  for (const criterion of slots.seriousness ?? []) {
    const base = {
      basis: "declared" as const,
      trigger: null,
      assertedBy: "reporter" as const,
      confirmedByReviewer: false,
      rejectedByReviewer: false,
    };
    flags[criterion] =
      criterion === "hospitalisation" ? { ...base, kind: "initial" } : base;
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

export function intakeToCase(input: IntakeCaseInput): Case {
  const { slots, ids } = input;
  const contact = splitContact(slots.reporterContact);

  const drug: SuspectDrug = {
    id: DrugId.parse(ids.drugId),
    reportedName: slots.drug ?? "Not stated",
    activeSubstance: null,
    role: "suspect",
    // A public reporter cannot know this, and guessing would route the case at
    // the wrong company document. A reviewer sets it during triage.
    marketingStatus: "marketed",
    dose: null,
    route: null,
    indication: null,
    therapyStart: null,
    therapyEnd: null,
    dechallenge: null,
    rechallenge: null,
  };

  const reaction: Reaction = {
    id: ReactionId.parse(ids.reactionId),
    verbatimTerm: slots.reaction ?? "Not stated",
    meddraPreferredTerm: null,
    onset: null,
    outcome: "unknown",
    seriousness: declaredFlags(slots),
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
    narrative: slots.narrative ?? "",
    status: "received",
    assignedTo: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

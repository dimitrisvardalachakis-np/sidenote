/**
 * Turn a submitted report into a Case the reviewer queue can show.
 *
 * The mapping from plain questions onto the regulatory concepts happens here
 * and nowhere else. A reporter answered "Did they go to hospital?"; this is
 * the file that decides that means the hospitalisation criterion. Keeping it
 * in one place means the reporter-facing wording can change without anybody
 * touching the domain, which is the whole reason the two vocabularies were
 * kept apart.
 *
 * Every seriousness flag produced here has basis "declared" and a null
 * trigger. The reporter ticked a box; there is no phrase in a narrative to
 * point at, and the schema refuses to let a declared flag claim one.
 */
import {
  Case,
  CaseId,
  CaseReference,
  DrugId,
  NO_SERIOUSNESS_FLAGS,
  ReactionId,
  type IsoDate,
  type PatientSex,
  type Reaction,
  type ReactionOutcome,
  type SeriousnessCriterion,
  type SeriousnessFlags,
  type SuspectDrug,
} from "@/lib/schemas";
import { answerValue, isAnswered, type Answer } from "@/lib/schemas/answer";
import type { CurrentState, ReportDraft, YesNo } from "@/lib/schemas/report";

/** Only a plain "yes" raises a flag. Blank and "I don't know" do not. */
function saidYes(a: Answer<YesNo>): boolean {
  return a.status === "answered" && a.value === "yes";
}

/**
 * The plain questions, mapped onto the six criteria.
 *
 * "Did they go to hospital?" and "Did this make them stay longer?" both land
 * on hospitalisation, and which one was answered decides initial versus
 * prolonged. That distinction exists in CLAUDE.md and would be lost if both
 * questions just set a boolean.
 */
function seriousnessFrom(draft: ReportDraft): SeriousnessFlags {
  const flags: Record<string, unknown> = { ...NO_SERIOUSNESS_FLAGS };

  const declare = (criterion: SeriousnessCriterion, extra: object = {}) => {
    flags[criterion] = {
      basis: "declared",
      trigger: null,
      assertedBy: "reporter",
      confirmedByReviewer: false,
      rejectedByReviewer: false,
      ...extra,
    };
  };

  if (saidYes(draft.died)) declare("death");
  if (saidYes(draft.lifeInDanger)) declare("life_threatening");
  if (saidYes(draft.lastingProblem)) declare("persistent_disability");
  if (saidYes(draft.babyHarmed)) declare("congenital_anomaly");
  if (saidYes(draft.wentToHospital)) {
    declare("hospitalisation", {
      kind: saidYes(draft.stayedLongerInHospital) ? "prolonged" : "initial",
    });
  }

  return flags as SeriousnessFlags;
}

/** Plain wording for "how are they now" onto the regulator's outcome list. */
function outcomeFrom(state: CurrentState | null): ReactionOutcome {
  switch (state) {
    case "better_now":
      return "recovered";
    case "getting_better":
      return "recovering";
    case "no_change":
      return "not_recovered";
    case "worse":
      return "not_recovered";
    case "died":
      return "fatal";
    case null:
      return "unknown";
  }
}

export interface ReportToCaseInput {
  readonly draft: ReportDraft;
  readonly reference: CaseReference;
  readonly receivedAt: IsoDate;
  readonly now: string;
  readonly ids: {
    readonly caseId: string;
    readonly drugId: string;
    readonly reactionId: string;
  };
}

export function reportToCase(input: ReportToCaseInput): Case {
  const { draft, ids } = input;

  const whatHappened = answerValue(draft.whatHappened) ?? "";
  const sex = answerValue(draft.sex);

  const drug: SuspectDrug = {
    id: DrugId.parse(ids.drugId),
    reportedName: answerValue(draft.medicineName) ?? "Not stated",
    activeSubstance: null,
    role: "suspect",
    // A member of the public cannot know this and guessing would send the
    // case to the wrong company document. A reviewer sets it during triage.
    marketingStatus: "marketed",
    dose: answerValue(draft.dose),
    route: null,
    indication: answerValue(draft.takenFor),
    therapyStart: answerValue(draft.startedMedicineOn),
    therapyEnd: answerValue(draft.stoppedMedicineOn),
    // Dechallenge and rechallenge, assembled from the four plain questions.
    // Recorded as coming from the reporter, unconfirmed, because CLAUDE.md is
    // explicit that these are suggested and never concluded.
    dechallenge: isAnswered(draft.betterAfterStopping)
      ? {
          outcome: draft.betterAfterStopping.value === "yes" ? "positive" : "negative",
          suggestedBy: "reviewer",
          confirmedByReviewer: false,
          rejectedByReviewer: false,
          evidence: null,
        }
      : null,
    rechallenge: isAnswered(draft.cameBackAfterStartingAgain)
      ? {
          outcome:
            draft.cameBackAfterStartingAgain.value === "yes" ? "positive" : "negative",
          suggestedBy: "reviewer",
          confirmedByReviewer: false,
          rejectedByReviewer: false,
          evidence: null,
        }
      : null,
  };

  const reaction: Reaction = {
    id: ReactionId.parse(ids.reactionId),
    verbatimTerm: whatHappened.slice(0, 400) || "Not stated",
    meddraPreferredTerm: null,
    onset: answerValue(draft.startedOn),
    outcome: outcomeFrom(answerValue(draft.currentState)),
    seriousness: seriousnessFrom(draft),
  };

  const patientSex: PatientSex | null =
    sex === null ? null : sex === "other" ? "other" : sex;

  return Case.parse({
    id: CaseId.parse(ids.caseId),
    reference: input.reference,
    origin: "public_form",
    receivedAt: input.receivedAt,
    patient: {
      initials: null,
      ageYears: answerValue(draft.age),
      ageGroup: null,
      sex: patientSex,
      dateOfBirth: null,
      localIdentifier: null,
      weightKg: null,
    },
    reporter: {
      name: answerValue(draft.yourName),
      organisation: null,
      // The reporter typed a country name, not a code. The Case field expects
      // a two-letter code, so this stays null until a reviewer maps it rather
      // than being filled with a guess.
      country: null,
      qualification: null,
      email: answerValue(draft.yourEmail),
      phone: answerValue(draft.yourPhone),
      contactPermitted: !isAnswered(draft.mayContactYou)
        ? true
        : draft.mayContactYou.value === "yes",
    },
    drugs: [drug],
    reactions: [reaction],
    narrative: whatHappened,
    status: "received",
    assignedTo: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

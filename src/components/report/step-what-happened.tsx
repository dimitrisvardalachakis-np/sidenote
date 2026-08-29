"use client";

import { ChoiceQuestion, DateQuestion, TextQuestion } from "./questions";
import { HowBadDidItGet } from "./how-bad";
import { pronounsFor } from "@/lib/schemas/pronouns";
import { isAnswered } from "@/lib/schemas/answer";
import {
  CURRENT_STATE_LABELS,
  type CurrentState,
  type ReportDraft,
} from "@/lib/schemas/report";

/**
 * What went wrong, when it started, how things are now — and how bad it got.
 *
 * The six seriousness questions used to be their own step called "Hospital and
 * emergencies", which asked the reporter to describe the same event twice
 * under two headings. They are folded in here, after the narrative and the
 * outcome, which is the order somebody tells it in.
 */
export function StepWhatHappened({
  draft,
  update,
}: {
  draft: ReportDraft;
  update: (patch: Partial<ReportDraft>) => void;
}) {
  const p = pronounsFor(isAnswered(draft.about) ? draft.about.value : "someone_else");

  return (
    <div>
      <p className="text-prose">
        Tell us what you noticed. Write it however you like. There is no wrong
        way to do this.
      </p>

      <TextQuestion
        label="What went wrong?"
        hint="A few words is fine. For example, a rash on both arms."
        multiline
        placeholder="Write here"
        value={draft.whatHappened}
        onChange={(next) => update({ whatHappened: next })}
      />

      <DateQuestion
        legend="When did it start?"
        hint="If you only remember the month or the year, that is fine. Fill in what you know."
        value={draft.startedOn}
        onChange={(next) => update({ startedOn: next })}
      />

      <ChoiceQuestion<CurrentState>
        legend={`How are ${p.subject} now?`}
        choices={[
          { value: "better_now", label: CURRENT_STATE_LABELS.better_now },
          { value: "getting_better", label: CURRENT_STATE_LABELS.getting_better },
          { value: "no_change", label: CURRENT_STATE_LABELS.no_change },
          { value: "worse", label: CURRENT_STATE_LABELS.worse },
          ...(isAnswered(draft.about) && draft.about.value === "someone_else"
            ? [{ value: "died" as const, label: CURRENT_STATE_LABELS.died }]
            : []),
        ]}
        value={draft.currentState}
        onChange={(next) => update({ currentState: next })}
      />

      <div className="mt-6 border-t border-rule pt-4">
        <HowBadDidItGet draft={draft} update={update} />
      </div>
    </div>
  );
}

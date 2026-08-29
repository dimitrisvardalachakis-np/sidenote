"use client";

import { DateQuestion, TextQuestion } from "./questions";
import { pronounsFor } from "@/lib/schemas/pronouns";
import { isAnswered } from "@/lib/schemas/answer";
import type { ReportDraft } from "@/lib/schemas/report";

/**
 * The medicine. Second, because it is what people lead with.
 *
 * "I took X and then Y happened" is how this story gets told out loud, and
 * everything else hangs off which medicine it was. It used to come fourth,
 * after the longest stretch of event questions, carrying ten questions
 * including the dechallenge sequence — the heaviest step in the form, placed
 * where fatigue was highest. That sequence is its own step now.
 */
export function StepMedicine({
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
        Now the medicine itself. The name is the important one. Everything else
        is a bonus.
      </p>

      <TextQuestion
        label="What is the medicine called?"
        hint="The name on the box or on the label."
        placeholder="For example, Amoxil"
        value={draft.medicineName}
        onChange={(next) => update({ medicineName: next })}
      />

      <TextQuestion
        label="Is there a batch number on the box?"
        hint="Sometimes called a lot number. A short line of letters and numbers. It helps us check a whole batch if we need to."
        value={draft.batchNumber}
        onChange={(next) => update({ batchNumber: next })}
      />

      <TextQuestion
        label={`How much did ${p.subject} take, and how often?`}
        hint="For example, one tablet twice a day."
        value={draft.dose}
        onChange={(next) => update({ dose: next })}
      />

      <TextQuestion
        label="What was the medicine for?"
        hint="The reason it was prescribed or bought."
        value={draft.takenFor}
        onChange={(next) => update({ takenFor: next })}
      />

      <DateQuestion
        legend={`When did ${p.subject} start taking it?`}
        value={draft.startedMedicineOn}
        onChange={(next) => update({ startedMedicineOn: next })}
      />
    </div>
  );
}

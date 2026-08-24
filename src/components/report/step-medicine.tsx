"use client";

import { DateQuestion, TextQuestion, YesNoQuestion } from "./questions";
import { pronounsFor } from "@/lib/schemas/pronouns";
import { isAnswered, UNANSWERED, type Answer } from "@/lib/schemas/answer";
import type { ReportDraft } from "@/lib/schemas/report";

const isYes = (a: Answer<"yes" | "no">) =>
  a.status === "answered" && a.value === "yes";

/**
 * Step 4. The medicine.
 *
 * The last four questions are what CLAUDE.md calls dechallenge and
 * rechallenge: did stopping help, and did it come back on restarting. The
 * reporter meets neither word. They are asked whether they stopped, whether
 * things improved, whether they started again, and whether it happened again,
 * which is the same information in the order a person would tell it.
 *
 * The follow-ups appear only when they mean something. "Did things get better
 * after stopping?" asked of someone who never stopped is noise, and answering
 * it would put a fact in the record that is not true.
 */
export function StepMedicine({
  draft,
  update,
}: {
  draft: ReportDraft;
  update: (patch: Partial<ReportDraft>) => void;
}) {
  const p = pronounsFor(isAnswered(draft.about) ? draft.about.value : "someone_else");
  const stopped = isYes(draft.stoppedMedicine);
  const restarted = isYes(draft.startedAgain);

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

      <YesNoQuestion
        legend={`Did ${p.subject} stop taking it?`}
        value={draft.stoppedMedicine}
        onChange={(next) =>
          update(
            isYes(next)
              ? { stoppedMedicine: next }
              : {
                  stoppedMedicine: next,
                  stoppedMedicineOn: UNANSWERED,
                  betterAfterStopping: UNANSWERED,
                },
          )
        }
      />

      {stopped && (
        <>
          <DateQuestion
            legend={`When did ${p.subject} stop?`}
            value={draft.stoppedMedicineOn}
            onChange={(next) => update({ stoppedMedicineOn: next })}
          />
          <YesNoQuestion
            legend="Did things get better after stopping?"
            value={draft.betterAfterStopping}
            onChange={(next) => update({ betterAfterStopping: next })}
          />
        </>
      )}

      <YesNoQuestion
        legend={`Did ${p.subject} start taking it again later?`}
        value={draft.startedAgain}
        onChange={(next) =>
          update(
            isYes(next)
              ? { startedAgain: next }
              : { startedAgain: next, cameBackAfterStartingAgain: UNANSWERED },
          )
        }
      />

      {restarted && (
        <YesNoQuestion
          legend="Did the same thing happen again?"
          value={draft.cameBackAfterStartingAgain}
          onChange={(next) => update({ cameBackAfterStartingAgain: next })}
        />
      )}
    </div>
  );
}

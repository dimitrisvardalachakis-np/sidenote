"use client";

import { DateQuestion, YesNoQuestion } from "./questions";
import { pronounsFor } from "@/lib/schemas/pronouns";
import { isAnswered, UNANSWERED, type Answer } from "@/lib/schemas/answer";
import type { ReportDraft } from "@/lib/schemas/report";

const isYes = (a: Answer<"yes" | "no">) =>
  a.status === "answered" && a.value === "yes";

/**
 * Stopping and starting again. Optional, and it says so.
 *
 * This is what CLAUDE.md calls dechallenge and rechallenge: did stopping help,
 * and did it come back on restarting. The reporter meets neither word. They
 * are asked whether they stopped, whether things improved, whether they
 * started again, and whether it happened again — the same information in the
 * order a person would tell it.
 *
 * It used to sit at the bottom of a ten-question medicine step with nothing
 * marking it optional, which is the worst possible place for the most
 * confusing material in the form. Its own step, explicitly skippable.
 *
 * The follow-ups appear only when they mean something. "Did things get better
 * after stopping?" asked of someone who never stopped is noise, and answering
 * it would put a fact in the record that is not true.
 */
export function StepStopping({
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
        These four are the most useful questions on the whole form, and the
        easiest to skip. If you do not know, skip them — a guess here is worse
        than a blank.
      </p>

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

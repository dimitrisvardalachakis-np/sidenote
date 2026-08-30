"use client";

import { DateQuestion, YesNoQuestion } from "./questions";
import { pronounsFor } from "@/lib/schemas/pronouns";
import {
  isAnswered,
  isResolved,
  UNANSWERED,
  type Answer,
} from "@/lib/schemas/answer";
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
 *
 * ALL of them, including starting again. That one used to be asked
 * unconditionally, so answering "no, I never stopped taking it" was followed
 * immediately by "did you start taking it again later?" — a question that
 * contradicts the answer above it and has no true answer. Restarting is only a
 * thing that can happen after stopping; that is what makes rechallenge mean
 * anything, and the sequence now follows it.
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
                  // Everything below this question rests on having stopped, so
                  // withdrawing that answer withdraws them too rather than
                  // leaving four answers about a stop that did not happen.
                  stoppedMedicine: next,
                  stoppedMedicineOn: UNANSWERED,
                  betterAfterStopping: UNANSWERED,
                  startedAgain: UNANSWERED,
                  cameBackAfterStartingAgain: UNANSWERED,
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
          <YesNoQuestion
            legend={`Did ${p.subject} start taking it again later?`}
            value={draft.startedAgain}
            onChange={(next) =>
              update(
                isYes(next)
                  ? { startedAgain: next }
                  : {
                      startedAgain: next,
                      cameBackAfterStartingAgain: UNANSWERED,
                    },
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
        </>
      )}

      {/*
        Say the step is finished rather than leaving one question alone on a
        screen that promised four, which reads like something failed to load.
      */}
      {!stopped && isResolved(draft.stoppedMedicine) && (
        <p className="mt-6 text-meta text-slate">
          That is all we need here — the rest of this step is about what
          happened after stopping. Carry on to the last part.
        </p>
      )}
    </div>
  );
}

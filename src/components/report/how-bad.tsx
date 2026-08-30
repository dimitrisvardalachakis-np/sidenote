"use client";

import { YesNoQuestion } from "./questions";
import { pronounsFor } from "@/lib/schemas/pronouns";
import { isAnswered, UNANSWERED, type Answer } from "@/lib/schemas/answer";
import type { ReportDraft } from "@/lib/schemas/report";

const isYes = (a: Answer<"yes" | "no">) =>
  a.status === "answered" && a.value === "yes";

/**
 * "How bad did it get?" — the six seriousness questions.
 *
 * No longer its own step. Going to hospital IS what happened, and asking it
 * under a separate heading made a reporter answer the same question twice in
 * different words. These now sit inside "What happened", after the narrative,
 * which is where they belong in the telling.
 *
 * Each question here is one of the things CLAUDE.md lists, asked in words a
 * worried person would use. The reporter is never shown that list and is never
 * asked to decide which applies. They say what happened; the mapping is ours.
 *
 * Two shaping decisions:
 *
 * The follow-up about staying longer only appears once someone says they went
 * to hospital, because otherwise it is a question about nothing.
 *
 * "Did you die?" is never asked. On a report someone is writing about
 * themselves that question is absurd and upsetting, and the answer is evident
 * from the fact that they are typing. It appears only when the report is about
 * someone else.
 */
export function HowBadDidItGet({
  draft,
  update,
}: {
  draft: ReportDraft;
  update: (patch: Partial<ReportDraft>) => void;
}) {
  const about = isAnswered(draft.about) ? draft.about.value : "someone_else";
  const p = pronounsFor(about);
  const wentIn = isYes(draft.wentToHospital);

  /*
    A yes to any of these is the reporter telling us something frightening
    happened. Answering with the next question and nothing else reads as not
    having heard them.
  */
  const redFlag =
    isYes(draft.died) ||
    isYes(draft.lifeInDanger) ||
    isYes(draft.wentToHospital);

  return (
    <div>
      <h3 className="text-base font-medium">How bad did it get?</h3>
      <p className="mt-1 text-prose text-slate">
        These questions help us understand how serious this was. Answer only
        what you know.
      </p>

      <YesNoQuestion
        legend={`Did ${p.subject} have to go to hospital because of this?`}
        value={draft.wentToHospital}
        onChange={(next) =>
          update(
            // If the answer stops being yes, the follow-up underneath is about
            // nothing, so its old answer goes with it.
            isYes(next)
              ? { wentToHospital: next }
              : { wentToHospital: next, stayedLongerInHospital: UNANSWERED },
          )
        }
      />

      {wentIn && (
        <YesNoQuestion
          legend={`Did this make ${p.object} stay in hospital longer than planned?`}
          hint="For example, they were already in hospital for something else."
          value={draft.stayedLongerInHospital}
          onChange={(next) => update({ stayedLongerInHospital: next })}
        />
      )}

      <YesNoQuestion
        legend={`Was there a time when ${p.possessive} life was in danger?`}
        value={draft.lifeInDanger}
        onChange={(next) => update({ lifeInDanger: next })}
      />

      <YesNoQuestion
        legend={`Have ${p.subject} been left with a problem that has not gone away?`}
        hint="For example, something they still cannot do."
        value={draft.lastingProblem}
        onChange={(next) => update({ lastingProblem: next })}
      />

      <YesNoQuestion
        legend="Was a baby born with a health problem?"
        hint="Only answer this if the medicine was taken during a pregnancy."
        value={draft.babyHarmed}
        onChange={(next) => update({ babyHarmed: next })}
      />

      {about === "someone_else" && (
        <YesNoQuestion
          legend={`Did ${p.subject} die?`}
          value={draft.died}
          onChange={(next) => update({ died: next })}
        />
      )}

      {/*
        Said back to them, in place, as soon as they say it.

        It names what they told us and points at urgent help. It does not
        block the flow, does not diagnose, and does not use --signal — the red
        is the regulatory clock, and turning this red would be dressing a kind
        sentence up as an alarm. It only says what is true.
      */}
      {redFlag && (
        <div
          role="status"
          className="mt-4 border-l-2 border-ink bg-surface-sunken px-3 py-2"
        >
          <p className="text-prose">
            {isYes(draft.died)
              ? "You have told us someone died."
              : isYes(draft.lifeInDanger)
                ? `You have told us ${p.possessive} life was in danger.`
                : `You have told us ${p.subject} went to hospital.`}{" "}
            Thank you for saying so — it is important and a reviewer will see
            it.
          </p>
          <p className="mt-1 text-meta text-slate">
            If anything is still happening now, please contact a doctor or your
            local emergency services. This form is not monitored in real time.
            You can come back and finish this later.
          </p>
        </div>
      )}

      {/* Addressed to the reader, who is always "you" even when the report
          is about somebody else. Running the patient pronoun through here
          would produce "They may not know some of these", which is about the
          wrong person entirely. */}
      <p className="mt-6 text-meta text-slate">
        You may not know some of these. Saying so is genuinely useful, so
        please do not guess.
      </p>
    </div>
  );
}

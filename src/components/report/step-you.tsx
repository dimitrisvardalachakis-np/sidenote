"use client";

import { ChoiceQuestion, TextQuestion, YesNoQuestion } from "./questions";
import { isAnswered } from "@/lib/schemas/answer";
import type { ReporterRole, ReportDraft } from "@/lib/schemas/report";
import { REPORTER_ROLE_LABELS, formatProblems } from "@/lib/schemas/report";

/**
 * Step 5. About you.
 *
 * Name, email and phone are each optional on their own, but at least one is
 * needed before the report can be sent. That rule is not enforced field by
 * field, because "required" on three boxes when any one will do is a lie the
 * form tells. It is checked once, at the end, with a sentence saying so.
 *
 * "How are you involved?" is asked only of somebody reporting for another
 * person. Its first option used to be "It happened to me" — word for word the
 * option they had already chosen on step 1 — so a self-reporter met the same
 * question twice and had no way to know the form had heard them the first
 * time. Step 1 writes the role now; this step says what it holds and points
 * back to where it can be changed.
 */
export function StepYou({
  draft,
  update,
}: {
  draft: ReportDraft;
  update: (patch: Partial<ReportDraft>) => void;
}) {
  const aboutSelf = isAnswered(draft.about) && draft.about.value === "self";
  const problems = formatProblems(draft);
  const problemFor = (field: keyof ReportDraft) => {
    const found = problems.find((problem) => problem.field === field);
    return found === undefined ? {} : { problem: found.message };
  };

  return (
    <div>
      <p className="text-prose">
        Last part. We ask so that a person here can come back to you if
        something is not clear.
      </p>

      {aboutSelf ? (
        <p className="mt-6 border-l-2 border-rule pl-3 text-prose text-slate">
          You told us this happened to you, so we have you down as both the
          person it happened to and the person reporting it. Go back to the
          first step if that is not right.
        </p>
      ) : (
        <ChoiceQuestion<ReporterRole>
          legend="How are you connected to them?"
          choices={[
            {
              value: "family_or_friend",
              label: REPORTER_ROLE_LABELS.family_or_friend,
            },
            { value: "carer", label: REPORTER_ROLE_LABELS.carer },
            { value: "health_worker", label: REPORTER_ROLE_LABELS.health_worker },
            { value: "other", label: REPORTER_ROLE_LABELS.other },
          ]}
          value={draft.yourRole}
          onChange={(next) => update({ yourRole: next })}
        />
      )}

      <p className="mt-8 text-prose">
        Give us at least one of these three, so we can reach you.
      </p>

      <TextQuestion
        label="What is your name?"
        value={draft.yourName}
        onChange={(next) => update({ yourName: next })}
      />

      <TextQuestion
        label="What is your email address?"
        type="email"
        maxLength={254}
        value={draft.yourEmail}
        onChange={(next) => update({ yourEmail: next })}
        {...problemFor("yourEmail")}
      />

      <TextQuestion
        label="What is your phone number?"
        type="tel"
        maxLength={40}
        value={draft.yourPhone}
        onChange={(next) => update({ yourPhone: next })}
        {...problemFor("yourPhone")}
      />

      <TextQuestion
        label="Which country are you in?"
        hint="The name is fine. For example, Ireland."
        value={draft.country}
        onChange={(next) => update({ country: next })}
      />

      <YesNoQuestion
        legend="May we contact you about this report?"
        hint="If you say no, we will still use your report."
        value={draft.mayContactYou}
        onChange={(next) => update({ mayContactYou: next })}
      />
    </div>
  );
}

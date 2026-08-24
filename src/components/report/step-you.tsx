"use client";

import { ChoiceQuestion, TextQuestion, YesNoQuestion } from "./questions";
import type { ReporterRole, ReportDraft } from "@/lib/schemas/report";
import { REPORTER_ROLE_LABELS } from "@/lib/schemas/report";

/**
 * Step 5. About you.
 *
 * Name, email and phone are each optional on their own, but at least one is
 * needed before the report can be sent. That rule is not enforced field by
 * field, because "required" on three boxes when any one will do is a lie the
 * form tells. It is checked once, at the end, with a sentence saying so.
 */
export function StepYou({
  draft,
  update,
}: {
  draft: ReportDraft;
  update: (patch: Partial<ReportDraft>) => void;
}) {
  return (
    <div>
      <p className="text-prose">
        Last part. We ask so that a person here can come back to you if
        something is not clear.
      </p>

      <ChoiceQuestion<ReporterRole>
        legend="How are you involved?"
        choices={[
          { value: "self", label: REPORTER_ROLE_LABELS.self },
          { value: "family_or_friend", label: REPORTER_ROLE_LABELS.family_or_friend },
          { value: "carer", label: REPORTER_ROLE_LABELS.carer },
          { value: "health_worker", label: REPORTER_ROLE_LABELS.health_worker },
          { value: "other", label: REPORTER_ROLE_LABELS.other },
        ]}
        value={draft.yourRole}
        onChange={(next) => update({ yourRole: next })}
      />

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
        value={draft.yourEmail}
        onChange={(next) => update({ yourEmail: next })}
      />

      <TextQuestion
        label="What is your phone number?"
        type="tel"
        value={draft.yourPhone}
        onChange={(next) => update({ yourPhone: next })}
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

"use client";

import { ChoiceQuestion, NumberQuestion } from "./questions";
import { pronounsFor, type ReportAbout } from "@/lib/schemas/pronouns";
import { isAnswered } from "@/lib/schemas/answer";
import type { ReportDraft, Sex } from "@/lib/schemas/report";

/**
 * Step 1. Who this is about.
 *
 * This step does one job beyond collecting answers: it sets the pronouns for
 * every question after it. That is why it comes first and why it cannot be
 * skipped or answered with "I don't know" — nobody is unsure whether a thing
 * happened to them.
 *
 * The age and sex questions only appear once that choice is made, because
 * until then the wording would have to be neutral and neutral wording here is
 * clumsy ("How old is the person?"). Waiting costs one click and buys a
 * sentence that reads like a person wrote it.
 */
export function StepAbout({
  draft,
  update,
}: {
  draft: ReportDraft;
  update: (patch: Partial<ReportDraft>) => void;
}) {
  const about = isAnswered(draft.about) ? draft.about.value : null;
  const p = pronounsFor(about ?? "someone_else");

  return (
    <div>
      <p className="text-prose">
        First, we need to know who this is about. It changes the rest of the
        questions.
      </p>

      <ChoiceQuestion<ReportAbout>
        legend="Who is this report about?"
        choices={[
          { value: "self", label: "It happened to me" },
          { value: "someone_else", label: "It happened to someone else" },
        ]}
        value={draft.about}
        onChange={(next) => update({ about: next })}
        allowUnknown={false}
      />

      {about !== null && (
        <>
          <p className="mt-8 text-prose">
            Now a little about {about === "self" ? "you" : "them"}. You can skip
            anything you do not know.
          </p>

          <NumberQuestion
            label={`How old are ${p.subject}?`}
            hint="Your best guess is fine. Age in years."
            value={draft.age}
            onChange={(next) => update({ age: next })}
          />

          <ChoiceQuestion<Sex>
            legend={`Are ${p.subject} female or male?`}
            choices={[
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
              { value: "other", label: "Another way to describe it" },
            ]}
            value={draft.sex}
            onChange={(next) => update({ sex: next })}
            unknownLabel="I would rather not say"
          />

          <p className="mt-6 text-meta text-slate">
            We ask because a report is much more useful when we know a little
            about the person it happened to. We do not need a name.
          </p>
        </>
      )}
    </div>
  );
}

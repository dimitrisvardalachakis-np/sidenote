import { MISSING_MESSAGES } from "@/lib/schemas/report";

/**
 * What a reporter is told before they are asked anything.
 *
 * Three things, in this order, because that is the order they matter in to
 * someone who is frightened:
 *
 *   1. What happens to the report — a trained person reads it, no account.
 *   2. How long it takes, and that blanks are allowed.
 *   3. What to do if this is happening right now.
 *
 * THE THIRD LINE DID NOT EXIST ANYWHERE IN THIS APP. Somebody typing "swelling
 * of lips and tongue" — a real seeded case — is describing anaphylaxis into a
 * form that answers with the next intake question. Triage is not this tool's
 * job, but silence was a decision and it was the wrong one; every real adverse
 * event portal carries this line above the form.
 *
 * `--ink` with a `--slate` left rule, not `--signal`. The red is the
 * regulatory clock and nothing else, ever — and a permanent red block above
 * every question would be shouting at someone who is already worried.
 */
export function Orientation() {
  return (
    <section
      aria-label="Before you start"
      className="rounded-card border border-rule bg-surface p-5 shadow-card"
    >
      {/*
        The 3px --signal border is the ONLY --signal on any public page, and it
        is a border rather than text. The red is the regulatory clock
        everywhere else in this app; here it is doing the one other job a red
        edge can honestly do, and it does it without a permanent red block
        shouting at someone who is already worried.
      */}
      <p className="border-l-[3px] border-signal pl-4 text-prose text-ink">
        <strong className="font-semibold">
          If this is happening now and it is serious
        </strong>{" "}
        — chest pain, trouble breathing, swelling of the face or throat,
        fainting — contact a doctor or your local emergency services. This form
        is not monitored in real time.
      </p>
      <p className="mt-3 pl-4 text-body text-slate">
        A trained person reads every report and passes it to a safety reviewer.
        You do not need an account. It takes about five minutes, and you can
        leave anything blank if you do not know it.
      </p>
    </section>
  );
}

/**
 * The four things a report cannot go without, ticking as they are met.
 *
 * The intro promised you could leave anything blank; the last step then
 * blocked sending with a list of what was missing. Both were true, and the
 * reporter met them four minutes apart. This shows the four from the first
 * question, so the promise and the requirement stop contradicting each other.
 *
 * Everything not on this list is genuinely optional, which is worth stating
 * once rather than labelling thirty times.
 */
const REQUIRED_LABELS = {
  who_it_happened_to: "Who it happened to",
  the_medicine: "The medicine",
  what_happened: "What went wrong",
  who_you_are: "How to reach you",
} as const;

const REQUIRED_ORDER = [
  "who_it_happened_to",
  "the_medicine",
  "what_happened",
  "who_you_are",
] as const;

export function RequiredChecklist({
  missing,
}: {
  missing: readonly (keyof typeof REQUIRED_LABELS)[];
}) {
  const outstanding = new Set(missing);

  return (
    <section aria-label="What a report needs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-micro whitespace-nowrap uppercase tracking-label text-slate">
          A report needs these four
        </p>
        {outstanding.size > 0 && (
          <p className="text-meta text-slate-quiet">
            Everything else is optional.
          </p>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {REQUIRED_ORDER.map((element) => {
          const done = !outstanding.has(element);
          return (
            <li
              key={element}
              className={[
                "flex items-center gap-1.5 rounded-pill px-3 py-1 text-meta",
                done
                  ? "bg-steady-wash text-steady"
                  : "border border-rule text-slate",
              ].join(" ")}
            >
              <span aria-hidden="true">{done ? "✓" : "○"}</span>
              <span>{REQUIRED_LABELS[element]}</span>
              <span className="sr-only">{done ? "given" : "still needed"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The plain-language reason one of the four is still outstanding. */
export function missingMessage(
  element: keyof typeof REQUIRED_LABELS,
): string {
  return MISSING_MESSAGES[element];
}

/**
 * Done, current, remaining — as a rule rather than a wrapping list of names.
 *
 * The step names stay as accessible text so a screen reader still hears them;
 * the visual is five segments, because "step 2 of 5" is the only thing the eye
 * needs and the names were wrapping onto three lines on a phone.
 */
export function ProgressRule({
  steps,
  current,
}: {
  steps: readonly { readonly id: string; readonly title: string }[];
  current: number;
}) {
  return (
    <nav aria-label="Progress">
      <ol className="flex gap-1.5">
        {steps.map((step, index) => {
          const done = index < current;
          const here = index === current;
          return (
            <li key={step.id} className="flex-1">
              <div
                className={[
                  "h-1 rounded-pill",
                  done ? "bg-steady" : here ? "bg-ink" : "bg-rule",
                ].join(" ")}
              />
              <span className="sr-only">
                {step.title}
                {here ? " (current step)" : done ? " (done)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 font-mono text-micro uppercase tracking-label text-slate">
        Step {current + 1} of {steps.length} ·{" "}
        <span className="text-ink">{steps[current]?.title}</span>
      </p>
    </nav>
  );
}

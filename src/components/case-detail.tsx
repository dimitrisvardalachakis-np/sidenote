import {
  SERIOUSNESS_CRITERIA,
  SERIOUSNESS_LABELS,
  VALIDITY_CRITERIA,
  VALIDITY_LABELS,
  caseValidity,
  spanMatchesNarrative,
  type Case,
  type NarrativeSpan,
  type SeriousnessCriterion,
} from "@/lib/schemas";

interface Marked {
  readonly span: NarrativeSpan;
  readonly criterion: SeriousnessCriterion;
}

/**
 * The narrative, with the phrase behind each seriousness flag marked.
 *
 * CLAUDE.md: "The app highlights the exact phrase that triggered each flag."
 * Marking is done by OFFSET, not by searching for the quote — a document that
 * says "admitted to hospital" twice would otherwise get the wrong occurrence
 * marked, and the reviewer would be looking at a different sentence from the
 * one the model read.
 *
 * A span whose quote no longer matches the text at its offsets is dropped
 * rather than drawn. A highlight over the wrong words is worse than none.
 */
function HighlightedNarrative({
  text,
  marks,
}: {
  text: string;
  marks: readonly Marked[];
}) {
  const usable = marks
    .filter((m) => spanMatchesNarrative(text, m.span))
    .sort((a, b) => a.span.start - b.span.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const [index, mark] of usable.entries()) {
    // Overlapping flags: the first one wins. Nesting <mark> would produce a
    // stack of backgrounds nobody can read.
    if (mark.span.start < cursor) continue;
    if (mark.span.start > cursor) {
      parts.push(text.slice(cursor, mark.span.start));
    }
    parts.push(
      <mark
        key={`${mark.criterion}-${index}`}
        title={SERIOUSNESS_LABELS[mark.criterion]}
        className="bg-row-active text-ink decoration-slate underline decoration-dotted underline-offset-4"
      >
        {text.slice(mark.span.start, mark.span.end)}
      </mark>,
    );
    cursor = mark.span.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <p className="text-prose whitespace-pre-wrap">{parts}</p>;
}

/**
 * The four minimum criteria, always all four, ticked or not.
 *
 * Showing only what is missing would leave a valid case with an empty box and
 * no way to tell it apart from a box that failed to render. The rule is that
 * a reviewer can see the check was performed.
 */
function ValidityChecklist({ record }: { record: Case }) {
  const validity = caseValidity(record);

  return (
    <section aria-label="Case validity">
      <h3 className="text-micro uppercase tracking-label text-slate">
        Minimum criteria
      </h3>
      <ul className="mt-1">
        {VALIDITY_CRITERIA.map((criterion) => {
          const missing = validity.missing.includes(criterion);
          return (
            <li
              key={criterion}
              className="flex items-baseline justify-between gap-3 border-b border-rule py-1"
            >
              <span className={missing ? "text-base" : "text-base text-slate"}>
                {VALIDITY_LABELS[criterion]}
              </span>
              <span
                className={[
                  "shrink-0 text-micro uppercase tracking-label",
                  missing ? "font-medium text-ink" : "text-steady",
                ].join(" ")}
              >
                {missing ? "missing" : "present"}
              </span>
            </li>
          );
        })}
      </ul>
      {!validity.isValid && (
        <p className="mt-2 text-meta text-ink">
          This is not yet a valid report. It can still be triaged, but it
          cannot be submitted until the missing items are obtained.
        </p>
      )}
    </section>
  );
}

function SeriousnessList({ record }: { record: Case }) {
  const rows = record.reactions.flatMap((reaction) =>
    SERIOUSNESS_CRITERIA.map((criterion) => ({
      criterion,
      flag: reaction.seriousness[criterion],
    })).filter((row) => row.flag !== null),
  );

  if (rows.length === 0) {
    return (
      <section aria-label="Seriousness">
        <h3 className="text-micro uppercase tracking-label text-slate">
          Seriousness
        </h3>
        <p className="mt-1 text-base text-slate">
          None of the six criteria is flagged.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Seriousness">
      <h3 className="text-micro uppercase tracking-label text-slate">
        Seriousness
      </h3>
      <ul className="mt-1">
        {rows.map(({ criterion, flag }) => {
          if (flag === null) return null;
          return (
            <li key={criterion} className="border-b border-rule py-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={[
                    "text-base",
                    flag.rejectedByReviewer ? "text-slate line-through" : "",
                  ].join(" ")}
                >
                  {SERIOUSNESS_LABELS[criterion]}
                  {"kind" in flag && (
                    <span className="text-slate"> ({flag.kind})</span>
                  )}
                </span>
                <span className="shrink-0 text-micro uppercase tracking-label text-slate">
                  {/*
                    Three states, not two. A rejected flag is kept on the
                    record and shown as rejected rather than removed: it no
                    longer counts towards seriousness or the expedited clock,
                    but a flag that vanishes when a reviewer overrules it
                    destroys the audit trail of the overruling.
                  */}
                  {flag.rejectedByReviewer ? (
                    "rejected"
                  ) : flag.confirmedByReviewer ? (
                    <span className="text-steady">confirmed</span>
                  ) : (
                    `suggested by ${flag.assertedBy}`
                  )}
                </span>
              </div>
              {flag.trigger === null ? (
                /* A ticked box on the public form. There is no phrase, and
                   saying so is more honest than inventing one. */
                <p className="mt-0.5 text-meta text-slate">
                  Reported directly by the {flag.assertedBy} — no phrase in the
                  narrative to point at.
                </p>
              ) : (
                <p className="mt-0.5 text-meta text-slate">
                  From the narrative: “{flag.trigger.quote}”
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CaseDetail({ record }: { record: Case }) {
  const marks: Marked[] = record.reactions.flatMap((reaction) =>
    SERIOUSNESS_CRITERIA.flatMap((criterion) => {
      const flag = reaction.seriousness[criterion];
      // A rejected flag keeps its row but loses its highlight: marking the
      // narrative for a criterion a reviewer has struck down would keep
      // asserting it in the one place the reviewer reads most closely.
      return flag !== null && flag.trigger !== null && !flag.rejectedByReviewer
        ? [{ span: flag.trigger, criterion }]
        : [];
    }),
  );

  const drug = record.drugs[0];
  const reaction = record.reactions[0];

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-rule pb-3 sm:grid-cols-4">
        <Fact label="Drug">{drug?.reportedName ?? "—"}</Fact>
        <Fact label="Substance">{drug?.activeSubstance ?? "—"}</Fact>
        <Fact label="Reaction">{reaction?.verbatimTerm ?? "—"}</Fact>
        <Fact label="Coded as">{reaction?.meddraPreferredTerm ?? "not coded"}</Fact>
        <Fact label="Day 0">{record.receivedAt}</Fact>
        <Fact label="Origin">{record.origin.replace("_", " ")}</Fact>
        <Fact label="Outcome">
          {reaction?.outcome.replaceAll("_", " ") ?? "—"}
        </Fact>
        <Fact label="Governed by">
          {drug?.marketingStatus === "investigational"
            ? "Investigator's Brochure"
            : "CCDS"}
        </Fact>
      </dl>

      <section aria-label="Narrative" className="mt-4">
        <h3 className="text-micro uppercase tracking-label text-slate">
          Narrative
        </h3>
        <div className="mt-1">
          <HighlightedNarrative text={record.narrative} marks={marks} />
        </div>
      </section>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <SeriousnessList record={record} />
        <ValidityChecklist record={record} />
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-label text-slate">
        {label}
      </dt>
      <dd className="mt-0.5 text-base">{children}</dd>
    </div>
  );
}

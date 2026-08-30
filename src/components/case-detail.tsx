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
  numbering,
}: {
  text: string;
  marks: readonly Marked[];
  /** Criterion to display number, computed once so both views agree. */
  numbering: ReadonlyMap<string, number>;
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
      /*
        A 2px --slate underline and a --row-active fill, where this was a 6%
        ink wash and a dotted underline — effectively invisible, for a
        requirement CLAUDE.md states outright ("the app highlights the exact
        phrase that triggered each flag").

        The id and the index are what tie a mark to its row in the seriousness
        list beside it, in both directions: `:target` styling is not used, but
        the shared numbering means a reviewer can match "[2]" here to "[2]"
        there without counting highlights.
      */
      <mark
        key={`${mark.criterion}-${index}`}
        id={`mark-${mark.criterion}`}
        title={SERIOUSNESS_LABELS[mark.criterion]}
        className="bg-row-active text-ink underline decoration-slate decoration-2 underline-offset-4"
      >
        {text.slice(mark.span.start, mark.span.end)}
        <sup className="ml-0.5 font-medium text-slate no-underline">
          [{numbering.get(mark.criterion) ?? index + 1}]
        </sup>
      </mark>,
    );
    cursor = mark.span.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <>
      <p className="text-prose whitespace-pre-wrap">{parts}</p>
      {/*
        A legend, because a highlight with no key is a decoration. One line,
        and only when there is something to explain.
      */}
      {usable.length > 0 && (
        <p className="mt-2 text-micro text-slate">
          Marked phrases are the exact words behind a seriousness flag,
          numbered to match the list. A phrase is only marked when it still
          occurs in the narrative word for word.
        </p>
      )}
    </>
  );
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
      <h3 className="font-mono text-micro uppercase tracking-label text-slate">
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
                  "shrink-0 font-mono text-micro uppercase tracking-label",
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

function SeriousnessList({
  record,
  numbering,
}: {
  record: Case;
  /** The same map the narrative marks use, so [2] here is [2] there. */
  numbering: ReadonlyMap<string, number>;
}) {
  const rows = record.reactions.flatMap((reaction) =>
    SERIOUSNESS_CRITERIA.map((criterion) => ({
      criterion,
      flag: reaction.seriousness[criterion],
    })).filter((row) => row.flag !== null),
  );

  if (rows.length === 0) {
    return (
      <section aria-label="Seriousness">
        <h3 className="font-mono text-micro uppercase tracking-label text-slate">
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
      <h3 className="font-mono text-micro uppercase tracking-label text-slate">
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
                  {/*
                    The number that ties this row to its highlight in the
                    narrative. Absent when the flag has no phrase to point at —
                    a ticked box on the public form marks nothing, and a number
                    pointing at no highlight would be worse than none.
                  */}
                  {numbering.has(criterion) && (
                    <span className="mr-1 text-slate">
                      [{numbering.get(criterion)}]
                    </span>
                  )}
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

/**
 * The pieces of a case, exported separately.
 *
 * `CaseDetail` used to render all of them in one fixed order: nine cells of
 * administrative metadata, then the narrative, then the reporter, then
 * seriousness and validity — above the evidence a reviewer opened the case to
 * read. The page now places these itself, so the answer comes first and the
 * supporting material sits below it or in a context rail.
 *
 * Kept in one file because they all share the mark numbering, which has to be
 * computed once from the marks that actually render.
 */
export function caseMarkNumbering(record: Case): ReadonlyMap<string, number> {
  const marks = marksFor(record);
  return new Map<string, number>(
    marks
      .filter((m) => spanMatchesNarrative(record.narrative, m.span))
      .sort((a, b) => a.span.start - b.span.start)
      .map((m, index) => [m.criterion, index + 1]),
  );
}

function marksFor(record: Case): Marked[] {
  return record.reactions.flatMap((reaction) =>
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
}

/** The narrative with its seriousness phrases marked, beside the flag list. */
export function WhyThisIsSerious({ record }: { record: Case }) {
  const numbering = caseMarkNumbering(record);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <section aria-label="Narrative">
        <h3 className="font-mono text-micro uppercase tracking-label text-slate">
          Narrative
        </h3>
        <div className="mt-1">
          <HighlightedNarrative
            text={record.narrative}
            marks={marksFor(record)}
            numbering={numbering}
          />
        </div>
      </section>
      <SeriousnessList record={record} numbering={numbering} />
    </div>
  );
}

/** The administrative facts. Collapsed by default on the case screen. */
export function CaseFacts({ record }: { record: Case }) {
  const drug = record.drugs[0];
  const reaction = record.reactions[0];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 2xl:grid-cols-2">
      <Fact label="Drug">{drug?.reportedName ?? "—"}</Fact>
      <Fact label="Substance">{drug?.activeSubstance ?? "—"}</Fact>
      {/*
        The reaction spans the row. The grid stopped at four columns, so
        "liver failure, died" wrapped inside a narrow cell while the row it sat
        in was 1400px wide.
      */}
      <Fact label="Reaction" wide>
        {reaction?.verbatimTerm ?? "—"}
      </Fact>
      <Fact label="Coded as">{reaction?.meddraPreferredTerm ?? "not coded"}</Fact>
      <Fact label="Patient">
        {[
          record.patient?.ageYears !== null && record.patient?.ageYears !== undefined
            ? `${record.patient.ageYears}y`
            : (record.patient?.ageGroup ?? null),
          record.patient?.sex ?? null,
        ]
          .filter((part): part is string => part !== null && part !== "unknown")
          .join(", ") || "not stated"}
      </Fact>
      <Fact label="Day 0">{record.receivedAt}</Fact>
      <Fact label="Origin">{record.origin.replace("_", " ")}</Fact>
      <Fact label="Outcome">
        {reaction?.outcome.replaceAll("_", " ") ?? "—"}
      </Fact>
      <Fact label="Status">{record.status.replace("_", " ")}</Fact>
      <Fact label="Governed by">
        {drug?.marketingStatus === "investigational"
          ? "Investigator's Brochure"
          : "CCDS"}
      </Fact>
    </dl>
  );
}

export { ValidityChecklist, ReporterPanel };

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

  /*
    The numbering, computed once and shared.

    It is derived from the marks that will actually RENDER — sorted by where
    they appear in the narrative, and only those whose quote still matches the
    text at its offsets. Numbering the criteria instead would put a "[3]" beside
    a row whose highlight was dropped, which is a pointer to nothing.
  */
  const numbering = new Map<string, number>(
    marks
      .filter((m) => spanMatchesNarrative(record.narrative, m.span))
      .sort((a, b) => a.span.start - b.span.start)
      .map((m, index) => [m.criterion, index + 1]),
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
        <Fact label="Patient">
          {[
            record.patient?.ageYears !== null && record.patient?.ageYears !== undefined
              ? `${record.patient.ageYears}y`
              : (record.patient?.ageGroup ?? null),
            record.patient?.sex ?? null,
          ]
            .filter((part): part is string => part !== null && part !== "unknown")
            .join(", ") || "not stated"}
        </Fact>
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
        <h3 className="font-mono text-micro uppercase tracking-label text-slate">
          Narrative
        </h3>
        <div className="mt-1">
          <HighlightedNarrative
            text={record.narrative}
            marks={marks}
            numbering={numbering}
          />
        </div>
      </section>

      <ReporterPanel record={record} />

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <SeriousnessList record={record} numbering={numbering} />
        <ValidityChecklist record={record} />
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  /** Span the whole row, for a value long enough to wrap in one cell. */
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-3 2xl:col-span-2" : undefined}>
      <dt className="font-mono text-micro uppercase tracking-label text-slate">
        {label}
      </dt>
      {/* break-words so an email or a long term wraps instead of overlapping. */}
      <dd className="mt-0.5 text-base break-words">{children}</dd>
    </div>
  );
}

/**
 * Who reported this, and how to reach them.
 *
 * THE GAP THIS FILLS. The minimum-criteria list told a reviewer "an
 * identifiable reporter — present" and the screen then showed neither the name
 * nor any way to contact them. The record has carried both the whole time;
 * nothing rendered them.
 *
 * For this app that is not a missing nicety. Follow-up is most of
 * pharmacovigilance — a case is usually incomplete on arrival, and the single
 * most common next action a reviewer takes is asking the reporter one more
 * question. A screen that asserts the reporter is identifiable while hiding
 * who they are makes the criterion decorative.
 *
 * `contactPermitted` is shown as prominently as the address, because contacting
 * someone who declined is a different kind of mistake from not contacting them.
 */
function ReporterPanel({ record }: { record: Case }) {
  const reporter = record.reporter;

  return (
    <section aria-label="Reporter">
      <h3 className="font-mono text-micro uppercase tracking-label text-slate">
        Reporter
      </h3>

      {reporter === null ? (
        <p className="mt-1 text-base text-slate">
          No reporter was recorded. Without one the report cannot be a valid
          case — see the minimum criteria above.
        </p>
      ) : (
        /*
          Two columns, not four, and the long values span both.

          An address is 25+ characters and the context rail is 18rem wide, so a
          four-column grid overlapped it with the field beside it. Long values
          get the whole row and `break-words`; short ones pair up.
        */
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2">
          <Fact label="Name" wide>
            {reporter.name ?? "not stated"}
          </Fact>
          <Fact label="Email" wide>
            {reporter.email ?? "—"}
          </Fact>
          <Fact label="Phone">{reporter.phone ?? "—"}</Fact>
          <Fact label="Contact">
            {reporter.contactPermitted ? "permitted" : "declined"}
          </Fact>
          {reporter.qualification !== null && (
            <Fact label="Qualification">
              {reporter.qualification.replaceAll("_", " ")}
            </Fact>
          )}
          {reporter.organisation !== null && (
            <Fact label="Organisation">{reporter.organisation}</Fact>
          )}
          {reporter.country !== null && (
            <Fact label="Country">{reporter.country}</Fact>
          )}
        </dl>
      )}
    </section>
  );
}

import type {
  Citation,
  ExpectednessFinding,
  ListednessFinding,
  ModelReading,
} from "@/lib/schemas";
import { documentStance } from "@/lib/schemas";
import { GeneratedNarrative } from "./narrative";

/**
 * The two evidence panels.
 *
 * Three states each, and they are visually distinct on purpose:
 *
 *   grounded            passages, quoted, with their chunk id
 *   no result found     the search ran and found nothing
 *   source unavailable  the search could not run
 *
 * The last two look different because they mean different things. "Nothing in
 * the CCDS mentions this" is a finding a reviewer can act on. "We could not
 * reach the CCDS" is not — it is an absence of information, and a reviewer who
 * mistakes one for the other can start a 15-day clock on the strength of an
 * outage. CLAUDE.md non-negotiable #8 is precisely this.
 *
 * Nothing here uses --signal. A degraded panel is not a regulatory deadline.
 *
 * The two panels are rendered SIDE BY SIDE at xl by the case screen, aligned
 * row for row: stance, generated summary, verified reading, passages. CLAUDE.md
 * promises "both side by side with citations" and the landing page repeats it
 * to the user; stacking them meant the comparison the product is built around
 * had to be done from memory while scrolling.
 */

function CitationBlock({
  citation,
  cited,
  source,
}: {
  citation: Citation;
  /** True when this is the passage the model's reading quotes from. */
  cited: boolean;
  /** "See in source" for this passage, when the corpus still holds it. */
  source?: React.ReactNode | undefined;
}) {
  return (
    <li className="border-t border-rule py-2 first:border-t-0">
      {/*
        The retrieved passage. Marked when it is the one the reading quotes, so
        a reviewer can get from the quotation above to its source without
        comparing chunk ids by eye. Marked with a rule, not a colour: --steady
        would read as "resolved" and --signal is reserved for the clock.
      */}
      <blockquote
        className={[
          "border-l-2 pl-3 text-prose",
          cited ? "border-ink" : "border-rule",
        ].join(" ")}
      >
        {citation.quote}
      </blockquote>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-micro uppercase tracking-label text-slate">
        {cited && <span className="text-ink">quoted above</span>}
        {/* "Every retrieval result must state which" — company or public. */}
        <span
          className={
            citation.sourceType === "company" ? "text-steady" : "text-slate"
          }
        >
          {citation.sourceType}
        </span>
        {citation.section !== null && (
          <span className="normal-case tracking-normal">
            {citation.section}
          </span>
        )}
        <span className="font-mono normal-case tracking-normal">
          {citation.chunkId}
        </span>
        {source}
      </div>
    </li>
  );
}

/**
 * What this document was observed to say, in three words, at the top of the
 * column — so the comparison can be made at a glance before any reading.
 *
 * It is `documentStance` rendered, and it is emphatically not a determination:
 * "describes" is an observation about a passage, where "listed" would be a
 * ruling. The wording keeps that distinction visible.
 */
function Stance({ stance }: { stance: "describes" | "silent" | "unknown" }) {
  const label =
    stance === "describes"
      ? "describes this reaction"
      : stance === "silent"
        ? "silent on this reaction"
        : "not read";
  return (
    <p
      className={[
        "text-base",
        stance === "describes" ? "font-medium text-ink" : "text-slate",
      ].join(" ")}
    >
      {label}
    </p>
  );
}

function PanelShell({
  heading,
  note,
  stance,
  children,
}: {
  heading: string;
  note: string;
  stance: "describes" | "silent" | "unknown";
  children: React.ReactNode;
}) {
  return (
    <section aria-label={heading} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
        <h3 className="text-base font-medium">{heading}</h3>
        <p className="text-micro uppercase tracking-label text-slate">{note}</p>
      </div>
      <div className="mt-2">
        <Stance stance={stance} />
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * The model's reading of the passages below.
 *
 * This used to render a determination — the single word "unlisted" at title
 * size, with a caption explaining it was only a suggestion. The caption was
 * true and the word was still the largest thing in the panel, which is how a
 * suggestion becomes a decision in practice. There is no determination here
 * any more; there is a quotation, a sentence about it, and where it came from.
 *
 * The three states are visually distinct for the same reason the retrieval
 * states are. "The model read these and identified none" is a reading a
 * reviewer can weigh. "No reading could be produced" is not, and it must never
 * be mistaken for the first.
 */
function Reading({
  reading,
  citations,
}: {
  reading: ModelReading;
  citations: readonly Citation[];
}) {
  if (reading.status === "unavailable") {
    return (
      /*
        A one-line marker, not a paragraph.

        Both panels used to print the same three-line explanation and the same
        reason string, so a reviewer with no model configured read the identical
        text twice and neither copy said anything the other did not. The
        explanation is hoisted to a single notice above the pair; what stays
        here is the fact that THIS panel was not read. Dashed, never --signal.
      */
      <div className="border border-dashed border-rule px-3 py-1.5 rounded-soft">
        {/*
          The REASON, not the state. The stance line two rows above already
          says "not read", and repeating it here in a box was the same
          duplication one layer down from the one this change removed between
          the two panels.
        */}
        <p className="text-meta text-slate">{reading.reason}</p>
      </div>
    );
  }

  if (reading.status === "nothing_found") {
    return (
      <div className="border-b border-rule pb-2">
        <p className="text-base font-medium">
          No passage identified as describing this reaction
        </p>
        <p className="mt-0.5 text-meta text-slate">
          The model read the passages below and identified none of them as
          describing it. They are shown so you can check that reading — it is
          the reading that found nothing, not the document that says nothing.
        </p>
      </div>
    );
  }

  const source = citations.find((c) => c.chunkId === reading.chunkId);

  return (
    <div className="border-b border-rule pb-2">
      {/* The verified span. This is the claim; everything else is provenance. */}
      <blockquote className="border-l-2 border-steady pl-3 text-prose">
        {reading.quotedSpan}
      </blockquote>
      {reading.rationale !== null && (
        <p className="mt-1.5 text-meta text-ink">{reading.rationale}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-micro uppercase tracking-label text-slate">
        {source !== undefined && (
          <span className={source.sourceType === "company" ? "text-steady" : "text-slate"}>
            {source.sourceType}
          </span>
        )}
        {source?.section != null && (
          <span className="normal-case tracking-normal">{source.section}</span>
        )}
        <span className="font-mono normal-case tracking-normal">
          {reading.chunkId}
        </span>
        <span className="normal-case tracking-normal">
          read by <span className="font-mono">{reading.model}</span>
        </span>
      </div>
      <p className="mt-1 text-meta text-slate">
        Quoted word for word from the passage marked below, checked against the
        whole passage — of which an extract is shown, so these words may sit
        outside it. Not a determination: listedness is yours to record.
      </p>
    </div>
  );
}

function NoResult({ query, at }: { query: string; at: string }) {
  return (
    <div className="border border-rule px-3 py-3 rounded-soft">
      <p className="text-base font-medium">No matching passage</p>
      <p className="mt-1 text-meta text-slate">
        The search ran against this product&rsquo;s documents and matched no
        passage. That is a finding a reviewer can weigh — but it is a finding
        about a search, not a statement that the document is silent.
      </p>
      <p className="mt-2 font-mono text-meta text-slate">{query}</p>
      <p className="mt-0.5 text-micro uppercase tracking-label text-slate">
        searched {at.slice(0, 16).replace("T", " ")}
      </p>
    </div>
  );
}

function SourceUnavailable({ reason, at }: { reason: string; at: string }) {
  return (
    /* A dashed edge, not a red one: this is missing information, not danger. */
    <div className="border border-dashed border-rule px-3 py-3 rounded-soft">
      <p className="text-base font-medium">Source unavailable</p>
      <p className="mt-1 text-meta text-slate">
        The search could not run, so nothing can be concluded either way. This
        is not evidence that the reaction is absent.
      </p>
      <p className="mt-2 text-meta text-ink">{reason}</p>
      <p className="mt-0.5 text-micro uppercase tracking-label text-slate">
        attempted {at.slice(0, 16).replace("T", " ")}
      </p>
    </div>
  );
}

export function CompanyEvidence({
  finding,
  seeSource,
  about,
}: {
  finding: ListednessFinding;
  /** Renders a source-in-context control for one passage. */
  seeSource?: ((chunkId: string) => React.ReactNode) | undefined;
  /** "liver failure, died in Hepalex" — what this answer is about. */
  about?: string | undefined;
}) {
  const documentLabel =
    finding.documentKind === "ccds"
      ? "Company Core Data Sheet"
      : "Investigator's Brochure";

  return (
    <PanelShell
      heading="Company documents"
      note={`${documentLabel} · confidential`}
      stance={documentStance(finding)}
    >
      {finding.state === "grounded" && (
        <>
          {/*
            The generated summary sits ABOVE the single verified quotation.
            The user asked for the generated answer to be prominent, and
            burying it under the quotation defeats that. The quotation below
            still reads as the stronger evidence — it carries --steady, the
            summary carries only a label.
          */}
          <div className="mb-3">
            <GeneratedNarrative
              narrative={finding.narrative}
              onSeeSource={seeSource}
              about={about}
              footnote="Each sentence above was written by a model; each quotation beneath it was copied from the company document word for word and checked against it. Not a determination — listedness is yours to record."
            />
          </div>
          <Reading reading={finding.reading} citations={finding.citations} />
          <ul className="mt-2">
            {finding.citations.map((citation) => (
              <CitationBlock
                key={citation.chunkId}
                citation={citation}
                cited={
                  finding.reading.status === "read" &&
                  finding.reading.chunkId === citation.chunkId
                }
                source={seeSource?.(citation.chunkId)}
              />
            ))}
          </ul>
        </>
      )}
      {finding.state === "no_result" && (
        <NoResult query={finding.query} at={finding.retrievedAt} />
      )}
      {finding.state === "source_unavailable" && (
        <SourceUnavailable reason={finding.reason} at={finding.attemptedAt} />
      )}
    </PanelShell>
  );
}

export function PublicEvidence({
  finding,
  seeSource,
  about,
}: {
  finding: ExpectednessFinding;
  seeSource?: ((chunkId: string) => React.ReactNode) | undefined;
  about?: string | undefined;
}) {
  return (
    <PanelShell heading="FDA label" note="public" stance={documentStance(finding)}>
      {finding.state === "grounded" && (
        <>
          <div className="mb-3">
            <GeneratedNarrative
              narrative={finding.narrative}
              onSeeSource={seeSource}
              about={about}
              footnote="Each sentence above was written by a model; each quotation beneath it was copied from the FDA label word for word and checked against it. Not a determination — expectedness is yours to record."
            />
          </div>
          <Reading reading={finding.reading} citations={finding.citations} />
          <ul className="mt-2">
            {finding.citations.map((citation) => (
              <CitationBlock
                key={citation.chunkId}
                citation={citation}
                cited={
                  finding.reading.status === "read" &&
                  finding.reading.chunkId === citation.chunkId
                }
                source={seeSource?.(citation.chunkId)}
              />
            ))}
          </ul>
          {finding.labelSetId !== null && (
            <p className="mt-2 font-mono text-micro text-slate">
              SPL set {finding.labelSetId}
            </p>
          )}
        </>
      )}
      {finding.state === "no_result" && (
        <NoResult query={finding.query} at={finding.retrievedAt} />
      )}
      {finding.state === "source_unavailable" && (
        <SourceUnavailable reason={finding.reason} at={finding.attemptedAt} />
      )}
    </PanelShell>
  );
}

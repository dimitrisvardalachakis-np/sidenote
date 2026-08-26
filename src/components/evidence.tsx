import type {
  Citation,
  ExpectednessFinding,
  ListednessFinding,
  ModelReading,
} from "@/lib/schemas";

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
 * outage. CLAUDE.md non-negotiable #5 is precisely this.
 *
 * Nothing here uses --signal. A degraded panel is not a regulatory deadline.
 */

function CitationBlock({ citation }: { citation: Citation }) {
  return (
    <li className="border-t border-rule py-2 first:border-t-0">
      {/* The quoted span, which is the claim. Everything else is provenance. */}
      <blockquote className="border-l-2 border-rule pl-3 text-prose">
        {citation.quote}
      </blockquote>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-micro uppercase tracking-label text-slate">
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
      </div>
    </li>
  );
}

function PanelShell({
  heading,
  note,
  children,
}: {
  heading: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={heading}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{heading}</h3>
        <p className="text-micro uppercase tracking-label text-slate">{note}</p>
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
 * any more; there is a quotation and a sentence about it.
 *
 * The three states are visually distinct for the same reason the retrieval
 * states are. "The model read these and none describes the reaction" is a
 * reading a reviewer can weigh. "No reading could be produced" is not, and it
 * must never be mistaken for the first.
 */
function Reading({ reading }: { reading: ModelReading }) {
  if (reading.status === "unavailable") {
    return (
      /* Dashed, never --signal. A missing reading is not a deadline. */
      <div className="border border-dashed border-rule px-3 py-2 rounded-soft">
        <p className="text-base font-medium">Assessment unavailable</p>
        <p className="mt-1 text-meta text-slate">
          The passages below were retrieved, but no reading of them could be
          produced. This is not a finding that the document is silent — nothing
          has read it. Read the passages yourself.
        </p>
        <p className="mt-2 text-meta text-ink">{reading.reason}</p>
      </div>
    );
  }

  if (reading.status === "nothing_found") {
    return (
      <div className="border-b border-rule pb-2">
        <p className="text-base font-medium">
          No passage below describes this reaction
        </p>
        <p className="mt-0.5 text-meta text-slate">
          The retrieved passages were read and none was identified as
          describing it. The passages are shown so you can check that reading.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-rule pb-2">
      {/* The verified span. This is the claim; everything else is provenance. */}
      <blockquote className="border-l-2 border-steady pl-3 text-prose">
        {reading.quotedSpan}
      </blockquote>
      {reading.rationale !== null && (
        <p className="mt-1.5 text-meta text-ink">{reading.rationale}</p>
      )}
      <p className="mt-1 text-micro uppercase tracking-label text-slate">
        <span className="font-mono normal-case tracking-normal">
          {reading.chunkId}
        </span>
        {" · read by "}
        <span className="font-mono normal-case tracking-normal">
          {reading.model}
        </span>
      </p>
      <p className="mt-1 text-meta text-slate">
        A reading of the passage quoted, checked to occur in it word for word.
        It is not a determination — listedness is yours to record below.
      </p>
    </div>
  );
}

function NoResult({ query, at }: { query: string; at: string }) {
  return (
    <div className="border border-rule px-3 py-3 rounded-soft">
      <p className="text-base font-medium">Nothing found</p>
      <p className="mt-1 text-meta text-slate">
        The search ran and matched no passage. That is a finding: this document
        appears not to describe the reaction.
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

export function CompanyEvidence({ finding }: { finding: ListednessFinding }) {
  const documentLabel =
    finding.documentKind === "ccds"
      ? "Company Core Data Sheet"
      : "Investigator's Brochure";

  return (
    <PanelShell heading="Company documents" note={`${documentLabel} · confidential`}>
      {finding.state === "grounded" && (
        <>
          <Reading reading={finding.reading} />
          <ul className="mt-2">
            {finding.citations.map((citation) => (
              <CitationBlock key={citation.chunkId} citation={citation} />
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

export function PublicEvidence({ finding }: { finding: ExpectednessFinding }) {
  return (
    <PanelShell heading="FDA label" note="public">
      {finding.state === "grounded" && (
        <>
          <Reading reading={finding.reading} />
          <ul className="mt-2">
            {finding.citations.map((citation) => (
              <CitationBlock key={citation.chunkId} citation={citation} />
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

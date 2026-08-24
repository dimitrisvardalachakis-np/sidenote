import type {
  Citation,
  ExpectednessFinding,
  ListednessFinding,
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

/** Shown when the model has an answer. Always labelled as a suggestion. */
function Determination({ value }: { value: string }) {
  return (
    <div className="border-b border-rule pb-2">
      <p className="text-title font-medium">{value}</p>
      <p className="mt-0.5 text-meta text-slate">
        Suggested by the model from the passages below. Not a decision — a
        reviewer accepts or rejects it.
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
          <Determination value={finding.determination} />
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
          <Determination value={finding.determination} />
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

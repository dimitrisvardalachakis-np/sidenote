import type {
  Citation,
  ExpectednessFinding,
  GroundedNarrative,
  ListednessFinding,
  ModelReading,
} from "@/lib/schemas";
import { documentStance } from "@/lib/schemas";
import { GeneratedNarrative } from "./narrative";
import { formatDateTime } from "@/lib/format/datetime";

/**
 * The two evidence panels, side by side in ONE card.
 *
 * They used to be two bordered boxes with a gap between them, which read as
 * two things that happen to be next to each other. They are not: the whole
 * product is the comparison, and CLAUDE.md says that when the two disagree
 * THAT is the case. One card split by a single hairline says "one object, two
 * halves" in a way two cards cannot.
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
 */

/**
 * The pair, as one object.
 *
 * `gap-px` over a --rule ground is what draws the divider: one rule between
 * the halves at xl, and the same rule as a horizontal line when they stack
 * below it. No border to double up, and nothing to leave a hairline artefact
 * in the stacked layout, because the "artefact" is the divider doing its job
 * in the other direction.
 */
export function EvidencePair({
  company,
  publicLabel,
}: {
  company: React.ReactNode;
  publicLabel: React.ReactNode;
}) {
  return (
    <div className="grid gap-px overflow-hidden rounded-card border border-rule bg-rule shadow-card xl:grid-cols-2">
      <div className="bg-surface p-4">{company}</div>
      <div className="bg-surface p-4">{publicLabel}</div>
    </div>
  );
}

/**
 * What this document was observed to say, in three words, at the top of the
 * column — so the comparison can be made at a glance before any reading.
 *
 * It is `documentStance` rendered, and it is emphatically not a determination:
 * "describes it" is an observation about a passage, where "listed" would be a
 * ruling. The wording keeps that distinction visible, and only the affirmative
 * state gets --steady — a document that says nothing is not a resolved thing.
 */
function Stance({ stance }: { stance: "describes" | "silent" | "unknown" }) {
  const label =
    stance === "describes"
      ? "describes it"
      : stance === "silent"
        ? "does not describe it"
        : "not read";
  return (
    <span
      className={[
        "shrink-0 rounded-pill px-2.5 py-1 text-meta",
        stance === "describes"
          ? "bg-steady-wash font-medium text-steady"
          : "bg-surface-sunken text-slate",
      ].join(" ")}
    >
      {label}
    </span>
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-micro uppercase tracking-label text-slate">
            {heading}
          </h3>
          <p className="mt-1 text-meta text-slate-quiet">{note}</p>
        </div>
        <Stance stance={stance} />
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A bordered, monospace provenance chip. */
function CiteChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-[5px] border border-rule px-1.5 py-0.5 font-mono text-micro text-slate">
      {children}
    </span>
  );
}

/**
 * The passage, with the verified span marked inside it.
 *
 * THE FALLBACK IS THE POINT. `Citation.quote` is a <=320-character excerpt and
 * the verified span can legitimately sit outside it, so the span is only
 * highlighted when it occurs in the excerpt VERBATIM — same character-for-
 * character test the build gate applies, no normalisation of whitespace,
 * quotes or dashes. When it does not occur, the excerpt is dropped and the
 * verified span is shown alone.
 *
 * A highlight drawn over approximately-matching words would be a claim that
 * the document contains a sentence it may not contain, which is the exact
 * failure non-negotiable #6 exists to prevent. Better to show less.
 */
function MarkedPassage({ quote, span }: { quote: string; span: string }) {
  const at = quote.indexOf(span);

  if (at === -1) {
    return (
      <blockquote className="border-l-[3px] border-steady pl-3 text-quote">
        {span}
      </blockquote>
    );
  }

  return (
    <blockquote className="border-l-[3px] border-steady pl-3 text-quote">
      {quote.slice(0, at)}
      <mark className="bg-steady-wash text-ink">{span}</mark>
      {quote.slice(at + span.length)}
    </blockquote>
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
  seeSource,
  rationalePromoted = false,
}: {
  reading: ModelReading;
  citations: readonly Citation[];
  seeSource?: ((chunkId: string) => React.ReactNode) | undefined;
  /**
   * True when `NarrativeSlot` above has already printed this reading's
   * rationale as the panel summary. MOVED, never copied: one sentence in two
   * places in one column reads as two findings that happen to agree, and a
   * reviewer counting corroboration would be counting the same inference
   * twice.
   */
  rationalePromoted?: boolean;
}) {
  if (reading.status === "unavailable") {
    return (
      /*
        A one-line marker, not a paragraph. The explanation belongs to the
        situation and is hoisted to a single notice above the pair; what stays
        here is the fact that THIS panel was not read. Dashed, never --signal.
      */
      <div className="rounded-soft border border-dashed border-rule px-3 py-2">
        <p className="text-meta text-slate">{reading.reason}</p>
      </div>
    );
  }

  if (reading.status === "nothing_found") {
    return (
      <div>
        <p className="text-base font-medium">
          No passage identified as describing this reaction
        </p>
        <p className="mt-1 text-meta text-slate">
          The model read the passages below and identified none of them as
          describing it. They are shown so you can check that reading — it is
          the reading that found nothing, not the document that says nothing.
        </p>
      </div>
    );
  }

  const source = citations.find((c) => c.chunkId === reading.chunkId);

  return (
    <div>
      {/* The verified span. This is the claim; everything else is provenance. */}
      <MarkedPassage
        quote={source?.quote ?? reading.quotedSpan}
        span={reading.quotedSpan}
      />
      {reading.rationale !== null && !rationalePromoted && (
        <p className="mt-2 text-meta text-slate">{reading.rationale}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {source !== undefined && (
          <CiteChip>
            {source.sourceType}
            {source.section !== null && ` · ${source.section}`}
          </CiteChip>
        )}
        <CiteChip>{reading.chunkId}</CiteChip>
        <CiteChip>read by {reading.model}</CiteChip>
        {seeSource?.(reading.chunkId)}
      </div>
      <p className="mt-2 text-meta text-slate-quiet">
        Quoted word for word from the passage marked above, checked against the
        whole passage — of which an extract is shown, so these words may sit
        outside it. Not a determination: listedness is yours to record.
      </p>
    </div>
  );
}

/**
 * Everything retrieved that the reading did not quote.
 *
 * Folded away rather than listed, because the panel's job is the comparison
 * and eight passages under each half buries it. Folded, not dropped: "every
 * AI output carries citations" means a reviewer must be able to reach the
 * whole retrieved set, and a disclosure is a reach rather than a wall.
 */
function OtherPassages({
  citations,
  quotedChunkId,
  sourceType,
  seeSource,
}: {
  citations: readonly Citation[];
  quotedChunkId: string | null;
  sourceType: "company" | "public";
  seeSource?: ((chunkId: string) => React.ReactNode) | undefined;
}) {
  const rest = citations.filter((c) => c.chunkId !== quotedChunkId);
  if (rest.length === 0) return null;

  return (
    <details className="mt-4 border-t border-rule pt-3">
      <summary className="cursor-pointer font-mono text-micro uppercase tracking-label text-slate hover:text-ink">
        {rest.length} more {rest.length === 1 ? "passage" : "passages"} retrieved
        {" · "}
        {sourceType === "company" ? "confidential" : "public"}
      </summary>
      <ul className="mt-2">
        {rest.map((citation) => (
          <li key={citation.chunkId} className="mt-3 first:mt-0">
            <blockquote className="border-l-[3px] border-rule pl-3 text-quote text-slate">
              {citation.quote}
            </blockquote>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CiteChip>
                {citation.sourceType}
                {citation.section !== null && ` · ${citation.section}`}
              </CiteChip>
              <CiteChip>{citation.chunkId}</CiteChip>
              {seeSource?.(citation.chunkId)}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function NoResult({ query, at }: { query: string; at: string }) {
  return (
    <div className="rounded-soft border border-rule px-3 py-3">
      <p className="text-base font-medium">No matching passage</p>
      <p className="mt-1 text-meta text-slate">
        The search ran against this product&rsquo;s documents and matched no
        passage. That is a finding a reviewer can weigh — but it is a finding
        about a search, not a statement that the document is silent.
      </p>
      <p className="mt-2 font-mono text-meta text-slate">{query}</p>
      <p className="mt-1 font-mono text-micro uppercase tracking-label text-slate-quiet">
        searched {formatDateTime(at)}
      </p>
    </div>
  );
}

function SourceUnavailable({ reason, at }: { reason: string; at: string }) {
  return (
    /* A dashed edge, not a red one: this is missing information, not danger. */
    <div className="rounded-soft border border-dashed border-rule px-3 py-3">
      <p className="text-base font-medium">Source unavailable</p>
      <p className="mt-1 text-meta text-slate">
        The search could not run, so nothing can be concluded either way. This
        is not evidence that the reaction is absent.
      </p>
      <p className="mt-2 text-meta text-ink">{reason}</p>
      <p className="mt-1 font-mono text-micro uppercase tracking-label text-slate-quiet">
        attempted {formatDateTime(at)}
      </p>
    </div>
  );
}

/**
 * Whether this panel's reading can stand in for a narrative that failed.
 *
 * Three conditions, all of them load-bearing. The narrative must have been
 * ATTEMPTED AND FAILED — `null` means none was ever tried, and there is
 * nothing to stand in for. The reading must be `read`: a panel whose reading
 * is `unavailable` or `nothing_found` has no sentence to promote and must go
 * on saying exactly what it says now. And the rationale must exist, because
 * `ModelReading` permits a `read` whose sentence was discarded while its
 * citation stood.
 */
function promotedRationale(
  narrative: GroundedNarrative | null,
  reading: ModelReading,
): { sentence: string; model: string; reason: string } | null {
  if (narrative === null || narrative.status !== "unavailable") return null;
  if (reading.status !== "read" || reading.rationale === null) return null;
  return {
    sentence: reading.rationale,
    model: reading.model,
    reason: narrative.reason,
  };
}

/**
 * The top of a grounded panel: the model's account of the passages.
 *
 * A reviewer must always find a sentence here when one exists. The panel used
 * to lead with "No written answer could be produced from these passages"
 * whenever the multi-point narrative failed — and the narrative is the call
 * that fails, because it does twice the work of a reading against a budget
 * that had to be raised for it. So the panel announced a failure while the
 * successful reading's own sentence sat three inches below it, unread. The
 * reading is the smaller claim and it had already survived the verbatim check;
 * leading with the failure buried the thing that worked.
 *
 * What is promoted is the rationale VERBATIM. Nothing is synthesised from the
 * passage text here — that would be this component inventing a reading, which
 * is the one thing no renderer may do — and the quotation, its chunk id and
 * its citation stay exactly where they were, below.
 *
 * The failure notice is demoted, not deleted. It drops to the provenance
 * register at the foot of the block, where it stays auditable: a reviewer
 * asking why this panel has one sentence rather than two can still find out.
 */
function NarrativeSlot({
  narrative,
  reading,
  footnote,
  about,
  onSeeSource,
}: {
  narrative: GroundedNarrative | null;
  reading: ModelReading;
  footnote: React.ReactNode;
  about?: string | undefined;
  onSeeSource?: ((chunkId: string) => React.ReactNode) | undefined;
}) {
  const promoted = promotedRationale(narrative, reading);

  if (promoted === null) {
    return (
      <GeneratedNarrative
        narrative={narrative}
        onSeeSource={onSeeSource}
        about={about}
        footnote={footnote}
      />
    );
  }

  return (
    /*
      The same frame `GeneratedNarrative` uses, and for its reasons: a reader
      must never mistake what a MODEL WROTE for what a DOCUMENT SAYS. So this
      block is contained, it is named "Written by AI" in as many words, and it
      is set in the body face — while the quotation below stays monospace
      behind a --steady rule. One header short of the narrative's four signals
      would be one signal short.
    */
    <section
      aria-label="AI-written answer"
      className="border border-rule rounded-soft"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule px-3 py-1.5">
        <p className="text-micro uppercase tracking-label text-ink">
          Written by AI
        </p>
        <p className="text-micro text-slate">
          <span className="font-mono">{promoted.model}</span> · from the passage
          quoted below
        </p>
      </header>

      <div className="px-3 py-2">
        {about !== undefined && (
          <p className="text-micro uppercase tracking-label text-slate">
            About {about}
          </p>
        )}
        <p className={about === undefined ? "text-prose" : "mt-1 text-prose"}>
          {promoted.sentence}
        </p>
      </div>

      <div className="border-t border-rule px-3 py-2">
        <p className="text-meta text-slate">{footnote}</p>
        {/*
          Quieter than the footnote above it, which is the register the "read
          by", "searched" and SPL lines occupy. Still a full sentence and still
          on the screen — this is why the panel shows one sentence instead of
          several, and a reviewer is entitled to know that.
        */}
        <p className="mt-1.5 text-micro text-slate-quiet">
          No multi-point written answer could be produced from these passages;
          the reading above and the passages below are unaffected.{" "}
          {promoted.reason}
        </p>
      </div>
    </section>
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
      heading="Company document"
      note={`${documentLabel} · confidential`}
      stance={documentStance(finding)}
    >
      {finding.state === "grounded" && (
        <>
          {/*
            The generated summary sits ABOVE the single verified quotation.
            The quotation below still reads as the stronger evidence — it
            carries --steady, the summary carries only a label.
          */}
          <div className="mb-4">
            <NarrativeSlot
              narrative={finding.narrative}
              reading={finding.reading}
              onSeeSource={seeSource}
              about={about}
              footnote="Each sentence above was written by a model; each quotation beneath it was copied from the company document word for word and checked against it. Not a determination — listedness is yours to record."
            />
          </div>
          <Reading
            reading={finding.reading}
            citations={finding.citations}
            seeSource={seeSource}
            rationalePromoted={
              promotedRationale(finding.narrative, finding.reading) !== null
            }
          />
          <OtherPassages
            citations={finding.citations}
            quotedChunkId={
              finding.reading.status === "read" ? finding.reading.chunkId : null
            }
            sourceType="company"
            seeSource={seeSource}
          />
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
    <PanelShell
      heading="Public FDA label"
      note="public"
      stance={documentStance(finding)}
    >
      {finding.state === "grounded" && (
        <>
          <div className="mb-4">
            <NarrativeSlot
              narrative={finding.narrative}
              reading={finding.reading}
              onSeeSource={seeSource}
              about={about}
              footnote="Each sentence above was written by a model; each quotation beneath it was copied from the FDA label word for word and checked against it. Not a determination — expectedness is yours to record."
            />
          </div>
          <Reading
            reading={finding.reading}
            citations={finding.citations}
            seeSource={seeSource}
            rationalePromoted={
              promotedRationale(finding.narrative, finding.reading) !== null
            }
          />
          <OtherPassages
            citations={finding.citations}
            quotedChunkId={
              finding.reading.status === "read" ? finding.reading.chunkId : null
            }
            sourceType="public"
            seeSource={seeSource}
          />
          {finding.labelSetId !== null && (
            <p className="mt-3 font-mono text-micro text-slate-quiet">
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

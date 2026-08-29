import type { GroundedNarrative } from "@/lib/schemas";

/**
 * The generated answer, and where every sentence of it came from.
 *
 * One renderer, imported by both surfaces. Two copies of the code that decides
 * which sentences appear would be two places for non-negotiable #3 to be
 * violated, and the public search page has always hand-rolled its own
 * rendering — so this is the part that gets shared, because this is the part
 * carrying the rule.
 *
 * THE ONE THING THIS LAYOUT MUST DO is make it impossible to confuse what a
 * MODEL WROTE with what a DOCUMENT SAYS. A reader who mistakes the first for
 * the second thinks a safety document contains a sentence a language model
 * composed. Four separate signals do that work, because one is not enough:
 *
 *   1. Containment. The whole block sits inside one bordered frame with a
 *      header, so it reads as a single thing that arrived together, rather
 *      than as prose that happens to sit above some quotations.
 *   2. Naming. The header says "Written by AI" in as many words, and the
 *      citation list is introduced by "Where each sentence comes from".
 *   3. Typeface. Model prose is the body face; every quoted span is monospace
 *      and indented behind a rule. Nothing in this app renders document text
 *      in monospace anywhere else, so the switch is a signal rather than a
 *      decoration.
 *   4. Attribution on each quote, individually — "quoted from the document",
 *      beside the passage id — so a screenshot of any single line still says
 *      which of the two it is.
 *
 * No `--signal`: that is the regulatory clock. No `--steady` on the prose
 * either — `--steady` means assessed, listed, resolved, and it is spoken for
 * by the single verified quotation in the panel below. A generated paragraph
 * must not read as equal to it.
 */
export function GeneratedNarrative({
  narrative,
  footnote,
  about,
  onSeeSource,
}: {
  narrative: GroundedNarrative | null;
  /** Each surface supplies its own closing sentence, in its own register. */
  footnote: React.ReactNode;
  /**
   * What the answer is about, in the reader's own terms — "liver failure,
   * died in Hepalex". Turns a floating paragraph into an answer to a question
   * somebody actually asked.
   */
  about?: string | undefined;
  /** Renders a "see in source" control for one chunk. Omitted where none exists. */
  onSeeSource?: ((chunkId: string) => React.ReactNode) | undefined;
}) {
  /*
    Null means no narrative was ever attempted — the reading did not succeed,
    or nothing was retrieved. There is nothing true to say, so nothing renders.
    This is distinct from `unavailable`, which means one was attempted.
  */
  if (narrative === null) return null;

  if (narrative.status === "unavailable") {
    return (
      /*
        One quiet line, no frame. Deliberately weaker than the "Assessment
        unavailable" panel beside it: that one says nothing has read the
        document, which is a far more serious statement, and the two must not
        be mistaken for each other.
      */
      <p className="text-meta text-slate">
        No written answer could be produced from these passages. The passages
        and the reading below are unaffected. {narrative.reason}
      </p>
    );
  }

  return (
    <section
      aria-label="AI-written answer"
      className="border border-rule rounded-soft"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule px-3 py-1.5">
        <p className="text-micro uppercase tracking-label text-ink">
          Written by AI
        </p>
        <p className="text-micro text-slate">
          <span className="font-mono">{narrative.model}</span> · from{" "}
          {narrative.points.length}{" "}
          {narrative.points.length === 1 ? "passage" : "passages"}
        </p>
      </header>

      <div className="px-3 py-2">
        {about !== undefined && (
          <p className="text-micro uppercase tracking-label text-slate">
            About {about}
          </p>
        )}

        {/*
          The model's own words. Body face, ordinary prose — the thing a reader
          is meant to read first. Every sentence carries the marker of the
          passage it came from, and the paragraph and the list below map the
          SAME array in the same order, so a marker without a citation and a
          citation without a marker are both unconstructible.
        */}
        <p className={about === undefined ? "text-prose" : "mt-1 text-prose"}>
          {narrative.points.map((point, index) => (
            <span key={point.chunkId}>
              {index > 0 && " "}
              {point.sentence}
              <sup className="ml-0.5 font-medium text-slate">[{index + 1}]</sup>
            </span>
          ))}
        </p>
      </div>

      <div className="border-t border-rule px-3 py-2">
        <p className="text-micro uppercase tracking-label text-slate">
          Where each sentence comes from
        </p>

        <ol className="mt-1.5">
          {narrative.points.map((point, index) => (
            <li key={point.chunkId} className="mt-2 flex gap-2 first:mt-0">
              <span className="shrink-0 pt-0.5 text-micro font-medium text-slate">
                [{index + 1}]
              </span>
              <div className="min-w-0 flex-1">
                {/*
                  Monospace, behind a rule. Document text is set differently
                  from model text everywhere in this block, so which is which
                  survives being screenshotted, skim-read, or read aloud.

                  The span shown is `point.quotedSpan`, never the matching
                  `Citation.quote`: the latter is a <=320-character excerpt from
                  `toCitation` and the verified span can sit outside it. What is
                  displayed is what was checked.
                */}
                <blockquote className="border-l-2 border-ink pl-2 font-mono text-meta">
                  {point.quotedSpan}
                </blockquote>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-micro text-slate">
                  <span>quoted from the document</span>
                  <span className="font-mono">{point.chunkId}</span>
                  {onSeeSource?.(point.chunkId)}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-2 text-meta text-slate">{footnote}</p>
      </div>
    </section>
  );
}

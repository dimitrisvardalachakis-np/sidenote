import type { GroundedNarrative } from "@/lib/schemas";

/**
 * The generated summary. One renderer, imported by both surfaces.
 *
 * Two copies of the code that decides which sentences appear would be two
 * places for non-negotiable #3 to be violated, and the public search page has
 * always hand-rolled its own rendering. This is the part carrying the rule, so
 * this is the part that gets shared.
 *
 * THREE RENDERING RULES DO THE WORK:
 *
 * The paragraph and the citation list map the SAME array, in the same order.
 * A marker without a citation and a citation without a marker are both
 * unconstructible — there is no lookup here that can fail, and no branch in
 * which a sentence renders alone.
 *
 * The quotation shown is `point.quotedSpan`, never the matching `Citation.quote`.
 * `toCitation` runs chunk text through `excerpt(…, 320)`, which truncates; the
 * verified span can sit outside that excerpt, and the reviewer panel already
 * has to warn about exactly that. Rendering the point's own span means the
 * span displayed is the span verified.
 *
 * No `--signal`, and no `--steady` either. `--signal` is the regulatory clock.
 * `--steady` is already spoken for by the single verified quotation in the
 * `Reading` block, which is stronger evidence than a generated paragraph and
 * must keep reading that way. This block is carried by a label and a rule, so
 * it sits below the quotation in the visual hierarchy rather than beside it.
 */
export function GeneratedNarrative({
  narrative,
  footnote,
  onSeeSource,
}: {
  narrative: GroundedNarrative | null;
  /** Each surface supplies its own closing sentence, in its own register. */
  footnote: React.ReactNode;
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
        One quiet line, no box and no border. Deliberately weaker than the
        "Assessment unavailable" panel beside it: that one says nothing has
        read the document, which is a far more serious statement, and these two
        must not be mistaken for each other.
      */
      <p className="text-meta text-slate">
        No combined account of these passages could be produced. The passages
        and the reading below are unaffected. {narrative.reason}
      </p>
    );
  }

  return (
    <section aria-label="Generated summary">
      {/*
        The "visibly AI-generated" requirement, carried by a label rather than
        by styling. A reader should not have to infer that a machine wrote this.
      */}
      <p className="text-micro uppercase tracking-label text-slate">
        Generated summary ·{" "}
        <span className="font-mono normal-case tracking-normal">
          {narrative.model}
        </span>
      </p>

      <p className="mt-1.5 text-prose">
        {narrative.points.map((point, index) => (
          <span key={point.chunkId}>
            {index > 0 && " "}
            {point.sentence}
            <sup className="ml-0.5 text-slate">[{index + 1}]</sup>
          </span>
        ))}
      </p>

      <ol className="mt-2">
        {narrative.points.map((point, index) => (
          <li key={point.chunkId} className="mt-1.5 flex gap-2">
            <span className="shrink-0 pt-0.5 text-micro text-slate">
              [{index + 1}]
            </span>
            <div className="min-w-0">
              {/*
                A small model often returns the passage itself as its sentence
                rather than a gloss on it — which is honest, and it passes every
                guard, but it means the same words render twice in a row. When
                they are identical the quotation is omitted here: it is already
                on screen a few lines above, attributed to this same marker.
                Nothing is hidden, and nothing is deduplicated across DIFFERENT
                text, which would be.
              */}
              {point.sentence.trim() !== point.quotedSpan.trim() && (
                <blockquote className="border-l-2 border-rule pl-2 text-meta">
                  {point.quotedSpan}
                </blockquote>
              )}
              {/*
                A <div>, not a <p>. `onSeeSource` renders a <dialog>, and a
                <dialog> inside a <p> is invalid HTML — the browser closes the
                paragraph early and React's hydration then fails against a tree
                that does not match what it rendered.
              */}
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-micro text-slate">
                <span className="font-mono">{point.chunkId}</span>
                {onSeeSource?.(point.chunkId)}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-meta text-slate">{footnote}</p>
    </section>
  );
}

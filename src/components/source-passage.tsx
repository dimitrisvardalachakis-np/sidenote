import Link from "next/link";
import { spanOffsets, type PassageContext } from "@/lib/library/context";
import { dailyMedUrl } from "@/lib/labels/dailymed";

/**
 * The contents of the source dialog: a passage in its surroundings.
 *
 * A server component, so the corpus never crosses to the client and the
 * dialog can only ever show text the server actually holds.
 *
 * WHAT IT SAYS ABOUT ITSELF. The original document text is not stored — only
 * the chunks — so the surrounding passages are stitched from the chunks either
 * side rather than sliced out of a page. They overlap by about 12%, so they
 * genuinely abut, but this is a reconstruction and the footer says so. Implying
 * a page image here would be the sort of small overclaim that makes a reviewer
 * doubt the citations too.
 */
export function SourcePassage({
  context,
  span,
  labelSetId,
}: {
  context: PassageContext;
  /** The verified quotation to mark, when there is one. */
  span: string | null;
  /** openFDA SPL set id, for the link out to the real record. */
  labelSetId: string | null;
}) {
  const { chunk, before, after, document, position, total } = context;
  const external = dailyMedUrl(labelSetId ?? chunk.documentId, chunk.sourceType);

  return (
    <div>
      <div className="border-b border-rule pb-2">
        <p className="text-base font-medium">
          {document?.title ?? "Document no longer held"}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-micro uppercase tracking-label text-slate">
          <span className={chunk.sourceType === "company" ? "text-steady" : ""}>
            {chunk.sourceType}
          </span>
          {document !== null && (
            <span className="normal-case tracking-normal">
              v{document.version} · {document.effectiveDate}
            </span>
          )}
        </p>
      </div>

      {chunk.section !== null && (
        <p className="mt-3 text-micro uppercase tracking-label text-slate">
          {chunk.section}
        </p>
      )}

      <div className="mt-2 text-prose">
        {/* Neighbours are dimmed so the cited passage stays the subject. */}
        {before.map((c) => (
          <p key={c.id} className="text-slate">
            {c.text}
          </p>
        ))}

        <p className="my-2 border-l-2 border-ink pl-3">
          <MarkedText text={chunk.text} span={span} />
        </p>

        {after.map((c) => (
          <p key={c.id} className="text-slate">
            {c.text}
          </p>
        ))}
      </div>

      <div className="mt-4 border-t border-rule pt-2">
        <p className="flex flex-wrap items-baseline gap-x-3 text-micro uppercase tracking-label text-slate">
          <span className="font-mono normal-case tracking-normal">{chunk.id}</span>
          <span>
            passage {position} of {total}
          </span>
        </p>
        {external !== null && (
          <p className="mt-1.5 text-meta">
            <Link
              href={external}
              target="_blank"
              rel="noopener noreferrer"
              className="text-steady hover:underline"
            >
              Open the FDA record on DailyMed ↗
            </Link>
          </p>
        )}
        <p className="mt-1.5 text-micro text-slate">
          The passages either side are the neighbouring chunks from ingestion,
          not a page image — the original document text is not stored, only the
          passages it was split into.
        </p>
      </div>
    </div>
  );
}

/**
 * The chunk's text with the verified span marked inside it.
 *
 * The same discipline as the narrative highlighting on the case screen: if the
 * span does not occur, it is DROPPED and the passage renders unmarked. Nothing
 * is trimmed or fuzzily matched until it fits — a mark in the wrong place is a
 * claim about where a quotation came from, and a wrong one is worse than none.
 */
function MarkedText({ text, span }: { text: string; span: string | null }) {
  const offsets = span === null ? null : spanOffsets(text, span);
  if (offsets === null) return <>{text}</>;

  return (
    <>
      {text.slice(0, offsets.start)}
      <mark className="bg-row-active text-ink underline decoration-slate decoration-2 underline-offset-4">
        {text.slice(offsets.start, offsets.end)}
      </mark>
      {text.slice(offsets.end)}
    </>
  );
}

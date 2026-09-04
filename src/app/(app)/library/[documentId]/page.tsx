import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCorpus } from "@/lib/store/corpus";
import { loadQueue } from "@/lib/queue/entries";
import { affectedCaseCount } from "@/lib/library/coverage";
import { dailyMedUrl } from "@/lib/labels/dailymed";
import { formatDateTime } from "@/lib/format/datetime";
import { DOCUMENT_KIND_LABELS } from "@/lib/schemas/document-upload";
import { REJECTION_MESSAGES, type IsoDate } from "@/lib/schemas";
import { todayInAthens } from "@/lib/format/datetime";

/**
 * One document, opened.
 *
 * The library was a shelf you could not look inside: documents did not open,
 * "5 chunks" was the only number on the page and it led nowhere. For a build
 * whose ingestion pipeline is a headline capability, that was the wrong thing
 * to hide — the chunking is the interesting part, and a reviewer who can see
 * it can tell a badly split document from a well split one.
 *
 * Everything here comes from `getDocumentLibrary().get()`, which has always
 * returned the whole entry including its chunks. Nothing new was stored to
 * make this page possible; it was only never rendered.
 */
export async function generateMetadata({
  params,
}: PageProps<"/library/[documentId]">): Promise<Metadata> {
  const { documentId } = await params;
  const { documents } = await loadCorpus();
  const document = documents.find((d) => d.id === documentId);
  return {
    title:
      document === undefined
        ? "Document not found — SideNote"
        : `${document.title} — SideNote`,
  };
}

export default async function DocumentPage({
  params,
}: PageProps<"/library/[documentId]">) {
  const { documentId } = await params;
  /*
    From the corpus, so a SEEDED document opens like an uploaded one. Reading
    the upload store instead would 404 on exactly the documents the demo ships
    with — the ones a reviewer is most likely to click first.
  */
  const { documents, chunks: allChunks } = await loadCorpus();
  const document = documents.find((d) => d.id === documentId);
  if (document === undefined) notFound();

  const ordered = allChunks
    .filter((chunk) => chunk.documentId === document.id)
    .sort((a, b) => a.ordinal - b.ordinal);
  const external = dailyMedUrl(document.id, document.sourceType);

  const today: IsoDate = todayInAthens();
  const queue = await loadQueue(today);
  const affected = affectedCaseCount(
    queue.map((entry) => ({ drugs: entry.record.drugs })),
    document,
  );

  /*
    Which passages a case has actually cited.

    The chunk id under each passage is precise and anonymous — it tells a
    reviewer nothing about whether this passage has ever mattered. This maps
    the ids an assessment cited back to the case that cited them, so a
    document page can say which of its passages are load-bearing.

    Read from the same findings the case screen renders: the quoted chunk on
    each reading, and every citation retrieved alongside it. Only ids this map
    confirms are labelled, so a passage never claims a case it did not inform.
  */
  const citedBy = new Map<string, string>();
  for (const entry of queue) {
    const assessment = entry.assessment;
    if (assessment === null) continue;
    for (const finding of [assessment.listedness, assessment.expectedness]) {
      if (finding.state !== "grounded") continue;
      const ids = [
        ...finding.citations.map((citation) => citation.chunkId),
        ...(finding.reading.status === "read" ? [finding.reading.chunkId] : []),
      ];
      for (const id of ids) {
        if (!citedBy.has(id)) citedBy.set(id, entry.record.reference);
      }
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-micro uppercase tracking-label text-slate">
          <li>
            <Link href="/library" className="hover:text-steady hover:underline">
              Library
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="normal-case tracking-normal text-ink">
            {document.title}
          </li>
        </ol>
      </nav>

      <h1 className="mt-1.5 text-h1 font-semibold">{document.title}</h1>
      <p className="mt-1 text-meta text-slate">
        {DOCUMENT_KIND_LABELS[document.kind]} ·{" "}
        {document.sourceType === "company" ? "confidential" : "public"} ·{" "}
        {document.activeSubstance}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 rounded-card border border-rule bg-surface p-5 shadow-card sm:grid-cols-4">
        <Fact label="Kind">{DOCUMENT_KIND_LABELS[document.kind]}</Fact>
        <Fact label="Source">
          <span
            className={document.sourceType === "company" ? "text-steady" : ""}
          >
            {document.sourceType === "company" ? "confidential" : "public"}
          </span>
        </Fact>
        <Fact label="Substance">{document.activeSubstance}</Fact>
        <Fact label="Version" mono>
          {document.version ?? "—"}
        </Fact>
        <Fact label="Effective" mono>
          {document.effectiveDate ?? "—"}
        </Fact>
        <Fact label="Passages" mono>
          {document.chunkCount}
        </Fact>
        <Fact label="Ingested" mono>
          {formatDateTime(document.uploadedAt)}
        </Fact>
        <Fact label="By">
          {/*
            Null means no reviewer put it here, and what that means depends on
            which shelf it is on: a public label with no uploader was fetched
            from openFDA the moment somebody named the medicine, while a
            company document with no uploader is one of the two the demo ships
            with. Saying "fetched from openFDA" for a seeded CCDS would be
            wrong about where a confidential document came from.
          */}
          {document.uploadedBy ?? (
            <span className="text-slate">
              {document.sourceType === "public"
                ? "fetched from openFDA"
                : "demo fixture"}
            </span>
          )}
        </Fact>
      </dl>

      <IngestionState
        status={document.status}
        rejectionReason={document.rejectionReason}
        affected={affected}
        substance={document.activeSubstance}
      />

      {external !== null && (
        <p className="mt-2 text-meta">
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

      <section aria-label="Passages" className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-h2 font-semibold">Passages</h2>
          <p className="font-mono text-micro uppercase tracking-label text-slate">
            {ordered.length} · structure-aware, ~512 tokens, ~12% overlap
          </p>
        </div>

        {ordered.length === 0 ? (
          <p className="mt-3 rounded-card border border-rule bg-surface px-4 py-4 text-meta text-slate shadow-card">
            No passages. Nothing was extracted from this document, so nothing
            can be retrieved from it or cited against it.
          </p>
        ) : (
          <ol className="mt-3 rounded-card border border-rule bg-surface px-5 shadow-card">
            {ordered.map((chunk) => {
              const citingCase = citedBy.get(chunk.id) ?? null;
              return (
                <li key={chunk.id} className="border-t border-rule py-3 first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-meta text-slate">
                      <span className="font-mono tabular-nums">
                        #{chunk.ordinal}
                      </span>
                      {chunk.section !== null && (
                        <span className="ml-2 text-ink">{chunk.section}</span>
                      )}
                    </p>
                    <p className="font-mono text-micro tabular-nums text-slate-quiet">
                      {chunk.tokenEstimate}t · chars {chunk.charStart}–
                      {chunk.charEnd}
                    </p>
                  </div>
                  {/*
                    The first lines, not the whole passage. This is an index —
                    the full text with its neighbours is what the source dialog
                    on the case screen is for.
                  */}
                  <p className="mt-1 line-clamp-2 text-base">{chunk.text}</p>
                  <p className="mt-1 font-mono text-micro text-slate-quiet">
                    {chunk.id}
                    {/*
                      Which passages are load-bearing. A chunk id is precise
                      and anonymous; this says whether any case has ever rested
                      on this one.
                    */}
                    {citingCase !== null && (
                      <span className="text-steady"> · cited by {citingCase}</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}

/**
 * Where this document got to in the pipeline, and what that means for search.
 *
 * The three states are kept apart for the reason the reading states are: a
 * reviewer who believes a document is fully indexed reads "no matching
 * passage" as a fact about the document rather than about the index.
 *
 * The "N cases can be re-assessed" sentence lives HERE rather than below,
 * because it is only true of a document search can reach. Printed under a
 * rejected scan it would have promised a re-assessment against a document
 * with nothing in it.
 */
function IngestionState({
  status,
  rejectionReason,
  affected,
  substance,
}: {
  status: string;
  rejectionReason: string | null;
  /** Cases in the queue naming this medicine. */
  affected: number;
  substance: string;
}) {
  if (status === "rejected") {
    return (
      /* Not --signal: the red means expedited or overdue, and a document that
         needs OCR is neither. */
      <div className="mt-4 rounded-card border border-dashed border-rule px-4 py-3">
        <p className="text-base font-medium">Not ingested</p>
        <p className="mt-1 text-meta text-ink">
          {rejectionReason !== null && rejectionReason in REJECTION_MESSAGES
            ? REJECTION_MESSAGES[
                rejectionReason as keyof typeof REJECTION_MESSAGES
              ]
            : "This document was refused."}
        </p>
        <p className="mt-1 text-meta text-slate">
          Nothing from it is searchable, and no citation can point at it.
        </p>
      </div>
    );
  }

  if (status === "chunking") {
    return (
      <p className="mt-4 text-meta text-slate">
        Chunked and mirrored. Keyword search only — not embedded, so semantic
        search will not reach it.
      </p>
    );
  }

  if (status === "embedded") {
    return (
      <div className="mt-4 rounded-card bg-steady-wash px-4 py-3">
        <p className="text-base text-steady">
          Chunked, mirrored and embedded. Keyword and semantic search.
        </p>
        {affected > 0 && (
          <p className="mt-1.5 text-meta text-ink">
            {affected} {affected === 1 ? "case" : "cases"} in the queue{" "}
            {affected === 1 ? "names" : "name"} this medicine and can now be
            re-assessed against it.{" "}
            <Link
              href={`/queue?q=${encodeURIComponent(substance)}`}
              className="text-steady underline"
            >
              Show {affected === 1 ? "it" : "them"}
            </Link>
            . Nothing re-runs on its own — a reviewer presses Assess.
          </p>
        )}
      </div>
    );
  }

  return (
    <p className="mt-4 text-meta text-slate">
      Ingestion has not finished. Nothing from this document is searchable yet.
    </p>
  );
}

function Fact({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  /** Dates, counts and versions. Everything a column of them should align. */
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-micro uppercase tracking-label text-slate">
        {label}
      </dt>
      <dd
        className={[
          "mt-1 break-words",
          mono ? "font-mono text-base tabular-nums" : "text-base",
        ].join(" ")}
      >
        {children}
      </dd>
    </div>
  );
}

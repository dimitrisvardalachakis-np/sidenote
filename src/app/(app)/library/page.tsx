import type { Metadata } from "next";
import Link from "next/link";
import { UploadPanel } from "./upload-panel";
import { loadCorpus } from "@/lib/store/corpus";
import { loadQueue } from "@/lib/queue/entries";
import { coverageBySubstance, isUncovered } from "@/lib/library/coverage";
import {
  REJECTION_MESSAGES,
  type IsoDate,
  type SafetyDocument,
} from "@/lib/schemas";
import { DOCUMENT_KIND_LABELS } from "@/lib/schemas/document-upload";

export const metadata: Metadata = {
  title: "Library — SideNote",
};

/**
 * The library: what we hold, and what we do not.
 *
 * The company/public split is the organising idea, not a detail: one column is
 * confidential material the company owns, the other is what anyone can read on
 * the FDA website. A reviewer must never be in doubt which they are looking
 * at, which is why the two are listed separately rather than mixed with a
 * badge — and why the filter offers one or the other rather than merging them.
 *
 * The uploader has moved BELOW the list, behind a disclosure. The library is
 * the content; adding to it is an action, and an action was taking the top of
 * the page from the thing the page is about.
 */
export default async function LibraryPage({
  searchParams,
}: PageProps<"/library">) {
  const params = await searchParams;
  const query = (readParam(params["q"]) ?? "").trim();
  const source = readSource(readParam(params["source"]));

  /*
    The CORPUS, not the upload store.

    `getDocumentLibrary().list()` returns only what a reviewer uploaded or what
    openFDA was fetched into; `loadCorpus()` is seeded documents plus those,
    and it is what retrieval actually searches. Listing the store alone made
    the coverage view report gaps that were not real — a seeded label counted
    as "not held" while the case screen was busy citing it. A library that
    disagrees with the search about what is on the shelf is worse than no
    library view at all.
  */
  const { documents } = await loadCorpus();

  const matching = documents.filter((doc) => {
    if (source !== "all" && doc.sourceType !== source) return false;
    if (query.length === 0) return true;
    const needle = query.toLowerCase();
    return (
      doc.title.toLowerCase().includes(needle) ||
      doc.activeSubstance.toLowerCase().includes(needle)
    );
  });

  const company = matching.filter((d) => d.sourceType === "company");
  const publicDocs = matching.filter((d) => d.sourceType === "public");

  /*
    Coverage is computed over EVERY document, not the filtered set. A gap is a
    fact about the shelf; hiding half the shelf and then reporting a gap would
    invent one.
  */
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const cases = (await loadQueue(today)).map((entry) => entry.record);
  const coverage = coverageBySubstance(documents);

  const href = (over: { q?: string; source?: string }) => {
    const next = new URLSearchParams();
    const q = over.q ?? query;
    if (q.length > 0) next.set("q", q);
    const s = over.source ?? source;
    if (s !== "all") next.set("source", s);
    const search = next.toString();
    return search.length === 0 ? "/library" : `/library?${search}`;
  };

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">
      <h1 className="text-h1 font-medium">Library</h1>
      <p className="mt-1 text-meta text-slate">
        Company safety documents and public labels, kept separate.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-rule py-2">
        <form method="get" action="/library" className="flex min-w-0 flex-1 gap-2">
          {source !== "all" && (
            <input type="hidden" name="source" value={source} />
          )}
          <label htmlFor="library-q" className="sr-only">
            Search the library
          </label>
          <input
            id="library-q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Title or active substance"
            className="min-w-0 flex-1 rounded-soft border border-rule bg-surface px-2 py-1 text-meta focus:outline-2 focus:outline-offset-1 focus:outline-steady"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-soft border border-rule px-3 py-1 text-meta hover:border-steady hover:text-steady"
          >
            Search
          </button>
        </form>

        <div className="flex gap-1">
          {(["all", "company", "public"] as const).map((option) => (
            <Link
              key={option}
              href={href({ source: option })}
              aria-pressed={source === option}
              className={[
                "rounded-soft border px-2 py-1 text-micro uppercase tracking-label",
                source === option
                  ? "border-steady bg-steady-wash text-steady"
                  : "border-rule text-slate hover:border-ink hover:text-ink",
              ].join(" ")}
            >
              {option}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <DocumentColumn
          heading="Company documents"
          note="Confidential. CCDS and Investigator's Brochures."
          documents={company}
          hidden={source === "public"}
        />
        <DocumentColumn
          heading="Public labels"
          note="Fetched from openFDA when a medicine is named. Covaxil and Hepalex are demo fixtures."
          documents={publicDocs}
          hidden={source === "company"}
        />
      </div>

      {/*
        What we hold per medicine, and — more usefully — what we do not.

        A case for a drug with no company document looked exactly like a case
        for a drug with one, right up until the search returned nothing.
      */}
      <section aria-label="Coverage" className="mt-10 border-t border-rule pt-4">
        <h2 className="text-base font-medium">What we hold, by medicine</h2>
        <p className="mt-0.5 text-meta text-slate">
          Grouped by active substance, which is what routes retrieval. A gap
          here is why a search comes back empty.
        </p>

        {coverage.length === 0 ? (
          <p className="mt-3 text-meta text-slate">Nothing held yet.</p>
        ) : (
          <ul className="mt-3 border-t border-rule">
            {coverage.map((row) => {
              const substance = row.drug.activeSubstance ?? "";
              const queued = cases.filter((record) =>
                record.drugs.some(
                  (drug) =>
                    drug.activeSubstance?.toLowerCase() === substance ||
                    drug.reportedName.toLowerCase().includes(substance),
                ),
              ).length;
              return (
                <li
                  key={substance}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b border-rule py-1.5 sm:grid-cols-[1fr_9rem_9rem_6rem]"
                >
                  <span className="text-base">{substance}</span>
                  <Held label="Company" documents={row.company} />
                  <Held label="FDA label" documents={row.publicLabel} />
                  <span className="text-meta text-slate">
                    {queued > 0 ? (
                      <Link
                        href={`/queue?q=${encodeURIComponent(substance)}`}
                        className="hover:text-steady hover:underline"
                      >
                        {queued} {queued === 1 ? "case" : "cases"}
                      </Link>
                    ) : (
                      "no cases"
                    )}
                  </span>
                  {isUncovered(row) && (
                    <span className="col-span-full text-meta text-ink">
                      Nothing held — a search for this medicine can only come
                      back empty.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        The uploader, below the list and folded away. It was at the top, above
        the thing the page is about.
      */}
      <details className="mt-10 border-t border-rule pt-4">
        <summary className="cursor-pointer text-base font-medium hover:text-steady">
          Add a document
        </summary>
        <div className="mt-3">
          <UploadPanel />
        </div>
      </details>
    </main>
  );
}

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readSource(raw: string | undefined): "all" | "company" | "public" {
  return raw === "company" || raw === "public" ? raw : "all";
}

/** One half of a medicine's coverage: held, or visibly not. */
function Held({
  label,
  documents,
}: {
  label: string;
  documents: readonly SafetyDocument[];
}) {
  const first = documents[0];
  if (first === undefined) {
    return (
      <span className="text-meta text-slate">
        {label}: <span className="text-ink">not held</span>
      </span>
    );
  }
  return (
    <span className="text-meta text-slate">
      {label}:{" "}
      <Link
        href={`/library/${first.id}`}
        className="text-steady hover:underline"
      >
        held{first.version !== null && ` v${first.version}`}
      </Link>
    </span>
  );
}

function DocumentColumn({
  heading,
  note,
  documents,
  hidden,
}: {
  heading: string;
  note: string;
  documents: readonly SafetyDocument[];
  hidden: boolean;
}) {
  if (hidden) return null;

  return (
    <section aria-label={heading}>
      <h2 className="text-base font-medium">{heading}</h2>
      <p className="mt-0.5 text-meta text-slate">{note}</p>

      {documents.length === 0 ? (
        <p className="mt-3 border-t border-rule pt-3 text-meta text-slate">
          Nothing here yet.
        </p>
      ) : (
        <ul className="mt-3 border-t border-rule">
          {documents.map((doc) => (
            <li key={doc.id} className="border-b border-rule py-2">
              <div className="flex items-baseline justify-between gap-3">
                {/* Documents open now. This is the link that was missing. */}
                <Link
                  href={`/library/${doc.id}`}
                  className="text-base hover:text-steady hover:underline"
                >
                  {doc.title}
                </Link>
                <p className="shrink-0 text-meta text-slate">
                  {doc.status === "rejected" ? (
                    // Not --signal: the red means expedited or overdue, and a
                    // document that needs OCR is neither.
                    <span className="font-medium text-ink">needs OCR</span>
                  ) : (
                    <span>{doc.chunkCount} passages</span>
                  )}
                </p>
              </div>
              <p className="mt-0.5 text-meta text-slate">
                {DOCUMENT_KIND_LABELS[doc.kind]}
                {doc.version !== null && ` · v${doc.version}`}
                {doc.effectiveDate !== null && ` · ${doc.effectiveDate}`}
                {` · ${doc.activeSubstance}`}
              </p>
              {doc.rejectionReason !== null && (
                <p className="mt-1 text-meta font-medium text-ink">
                  {REJECTION_MESSAGES[doc.rejectionReason]}
                </p>
              )}
              {/*
                Two states, kept apart on purpose.

                "Chunked and mirrored" is not a failure — the document is
                stored and lexically searchable, and that is what the sentence
                says. What it must not do is imply the semantic half saw it,
                because a reviewer who believes a document is fully indexed
                reads "no matching passage" as a fact about the document
                rather than about the index.
              */}
              {doc.status === "chunking" && (
                <p className="mt-0.5 text-meta text-slate">
                  Chunked and mirrored. Keyword search only — not embedded.
                </p>
              )}
              {doc.status === "embedded" && (
                <p className="mt-0.5 text-meta text-slate">
                  Chunked, mirrored and embedded. Keyword and semantic search.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

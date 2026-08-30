import type { Metadata } from "next";
import Link from "next/link";
import { Modal } from "@/components/modal";
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
 * The uploader is a button that opens a dialog. It used to be a <details> at
 * the foot of the page, which was the right instinct — the library is the
 * content and adding to it is an action — carried too far: the control was
 * below the coverage table, so adding a document meant scrolling past
 * everything the page holds to reach the way to add to it.
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 font-semibold">Library</h1>
          <p className="mt-1 text-meta text-slate">
            Company safety documents and public labels, kept separate.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form method="get" action="/library" className="flex gap-2">
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
              className="min-h-9 w-[15rem] rounded-soft border border-rule bg-surface px-3 py-1.5 text-meta placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
            />
            <button
              type="submit"
              className="min-h-9 cursor-pointer rounded-soft border border-rule bg-surface px-3 py-1.5 text-meta hover:border-steady-line hover:text-steady"
            >
              Search
            </button>
          </form>

          <Modal
            label="Add a document"
            title="Add a document"
            width="60ch"
            triggerClassName="min-h-9 cursor-pointer rounded-soft bg-steady px-4 py-1.5 text-meta font-medium text-surface hover:opacity-90"
          >
            <UploadPanel />
          </Modal>
        </div>
      </div>

      {/*
        The source filter, as a segmented control. It is one choice of three,
        which is what a segment is for — three separate outlined chips read as
        three independent toggles that happen to be adjacent.
      */}
      <div className="mt-4 inline-flex rounded-soft border border-rule bg-surface p-0.5">
        {(["all", "company", "public"] as const).map((option) => (
          <Link
            key={option}
            href={href({ source: option })}
            aria-pressed={source === option}
            className={[
              "min-h-8 rounded-[6px] px-3 py-1 font-mono text-micro uppercase tracking-label",
              source === option
                ? "bg-steady-wash text-steady"
                : "text-slate hover:text-ink",
            ].join(" ")}
          >
            {option}
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <DocumentColumn
          heading="Company documents"
          note="Confidential. CCDS and Investigator's Brochures."
          documents={company}
          hidden={source === "public"}
          tone="company"
        />
        <DocumentColumn
          heading="Public labels"
          note="Fetched from openFDA when a medicine is named. Covaxil and Hepalex are demo fixtures."
          documents={publicDocs}
          hidden={source === "company"}
          tone="public"
        />
      </div>

      {/*
        What we hold per medicine, and — more usefully — what we do not.

        A case for a drug with no company document looked exactly like a case
        for a drug with one, right up until the search returned nothing.
      */}
      {/*
        What we hold per medicine, and — more usefully — what we do not.

        A case for a drug with no company document looked exactly like a case
        for a drug with one, right up until the search returned nothing.
      */}
      <section
        aria-label="Coverage"
        className="mt-4 rounded-card border border-rule bg-surface p-5 shadow-card"
      >
        <h2 className="text-h2 font-semibold">What we hold, by medicine</h2>
        <p className="mt-1 text-meta text-slate">
          Grouped by active substance, which is what routes retrieval. A gap
          here is why a search comes back empty.
        </p>

        {coverage.length === 0 ? (
          <p className="mt-4 text-meta text-slate">Nothing held yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  <Th>Substance</Th>
                  <Th>Company document</Th>
                  <Th>FDA label</Th>
                  <Th>In the queue</Th>
                </tr>
              </thead>
              <tbody>
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
                    <tr key={substance} className="border-b border-rule last:border-b-0">
                      <td className="py-2.5 pr-4 text-base">{substance}</td>
                      <td className="py-2.5 pr-4">
                        <Held documents={row.company} />
                      </td>
                      <td className="py-2.5 pr-4">
                        <Held documents={row.publicLabel} />
                      </td>
                      <td className="py-2.5 text-meta text-slate">
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
                        {isUncovered(row) && (
                          <span className="mt-0.5 block text-meta text-ink">
                            Nothing held — a search for this medicine can only
                            come back empty.
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </main>
  );
}

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readSource(raw: string | undefined): "all" | "company" | "public" {
  return raw === "company" || raw === "public" ? raw : "all";
}

/** A table header cell, in the same mono micro label the queue uses. */
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="py-2 pr-4 font-mono text-micro font-normal uppercase tracking-label text-slate"
    >
      {children}
    </th>
  );
}

/**
 * One half of a medicine's coverage: held, or visibly not.
 *
 * "not held" stays --ink rather than --slate. It is the fact on this table a
 * reviewer most needs to notice — it is the reason a search comes back empty —
 * and it is not --signal either, because a gap on the shelf is not a
 * regulatory deadline.
 */
function Held({ documents }: { documents: readonly SafetyDocument[] }) {
  const first = documents[0];
  if (first === undefined) {
    return <span className="text-meta text-ink">not held</span>;
  }
  return (
    <Link
      href={`/library/${first.id}`}
      className="text-meta text-steady hover:underline"
    >
      held{first.version !== null && ` v${first.version}`}
    </Link>
  );
}

function DocumentColumn({
  heading,
  note,
  documents,
  hidden,
  tone,
}: {
  heading: string;
  note: string;
  documents: readonly SafetyDocument[];
  hidden: boolean;
  /** The square beside the heading. Teal is confidential; grey is public. */
  tone: "company" | "public";
}) {
  if (hidden) return null;

  return (
    <section
      aria-label={heading}
      className="rounded-card border border-rule bg-surface p-5 shadow-card"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={[
            "size-[7px] shrink-0 rounded-[2px]",
            tone === "company" ? "bg-steady" : "bg-slate-quiet",
          ].join(" ")}
        />
        <h2 className="text-h2 font-semibold">{heading}</h2>
      </div>
      <p className="mt-1 text-meta text-slate">{note}</p>

      {documents.length === 0 ? (
        <p className="mt-4 border-t border-rule pt-4 text-meta text-slate">
          Nothing here yet.
        </p>
      ) : (
        <ul className="mt-3">
          {documents.map((doc) => (
            <li key={doc.id} className="border-t border-rule">
              {/*
                The WHOLE ROW is the link. The title alone was the target,
                which made the passage count, the version and the ingestion
                state — everything that tells you whether this is the document
                you want — dead space beside a four-word hyperlink.
              */}
              <Link
                href={`/library/${doc.id}`}
                className="-mx-2 block rounded-soft px-2 py-3 hover:bg-surface-sunken"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14.5px] font-medium">{doc.title}</span>
                  <span className="shrink-0 font-mono text-meta text-slate">
                    {doc.status === "rejected" ? (
                      // Not --signal: the red means expedited or overdue, and
                      // a document that needs OCR is neither.
                      <span className="font-medium text-ink">needs OCR</span>
                    ) : (
                      <>
                        {doc.chunkCount}{" "}
                        <span className="text-slate-quiet">passages</span>
                      </>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-meta text-slate">
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
                  stored and lexically searchable, and that is what the
                  sentence says. What it must not do is imply the semantic half
                  saw it, because a reviewer who believes a document is fully
                  indexed reads "no matching passage" as a fact about the
                  document rather than about the index.
                */}
                {doc.status === "chunking" && (
                  <p className="mt-1 text-meta text-slate-quiet">
                    Chunked and mirrored. Keyword search only — not embedded.
                  </p>
                )}
                {doc.status === "embedded" && (
                  <p className="mt-1 text-meta text-slate-quiet">
                    Chunked, mirrored and embedded. Keyword and semantic search.
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

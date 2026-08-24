import Link from "next/link";
import { lexicalSearch, toCitation } from "@/lib/retrieval/search";
import { loadCorpus } from "@/lib/store/corpus";

/**
 * "Is this already known?" for the public.
 *
 * Searches the PUBLIC namespace only. There is no login on this page, and the
 * company library holds confidential CCDS text — the sourceType filter below
 * is the confidentiality boundary, not a relevance tweak.
 *
 * A server component with the query in the URL, so a result is linkable and
 * the back button behaves. No client JavaScript is needed to search.
 */
export default async function SearchPage({
  searchParams,
}: PageProps<"/report/search">) {
  const params = await searchParams;
  const raw = params["q"];
  const query = typeof raw === "string" ? raw.trim() : "";

  const { chunks, documents } = await loadCorpus();
  const hits =
    query.length > 1
      ? lexicalSearch(chunks, query, {
          sourceType: "public",
          limit: 8,
          minScore: 1.0,
        })
      : [];

  const titleFor = (documentId: string) =>
    documents.find((d) => d.id === documentId)?.title ?? "Unknown document";

  return (
    <main className="mx-auto w-full max-w-[70ch] px-4 py-8">
      <h1 className="text-title font-medium">Search known effects</h1>
      <p className="mt-2 text-prose text-slate">
        Look up whether a side effect is already described in a medicine&rsquo;s
        published information.
      </p>

      <form method="get" className="mt-5">
        <label htmlFor="q" className="text-base font-medium">
          What happened, and to which medicine?
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="rash on both hands, Covaxil"
            className="min-w-0 flex-1 rounded-soft border border-rule bg-paper px-2 py-1.5 text-base focus:outline-2 focus:outline-offset-1 focus:outline-steady"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-soft border border-ink bg-ink px-4 py-1.5 text-base text-paper hover:border-steady hover:bg-steady"
          >
            Search
          </button>
        </div>
        <p className="mt-1 text-meta text-slate">
          Only publicly available labels are searched.
        </p>
      </form>

      {query.length > 1 && (
        <section aria-label="Results" className="mt-6">
          <h2 className="text-micro uppercase tracking-label text-slate">
            {hits.length === 0
              ? "Nothing found"
              : `${hits.length} passage${hits.length === 1 ? "" : "s"}`}
          </h2>

          {hits.length === 0 ? (
            <div className="mt-2 border border-rule p-3 rounded-soft">
              <p className="text-prose">
                No published label we hold describes that. That is not a
                verdict — it may simply be a medicine we do not have, or
                different wording.
              </p>
              <p className="mt-2 text-prose">
                If it happened to you or someone you care for,{" "}
                <Link href="/report/chat" className="text-steady hover:underline">
                  report it
                </Link>
                . An unrecorded reaction is exactly what a safety reviewer needs
                to see.
              </p>
            </div>
          ) : (
            <>
              <ul className="mt-2 border-t border-rule">
                {hits.map((hit) => {
                  const citation = toCitation(hit);
                  return (
                    <li key={citation.chunkId} className="border-b border-rule py-3">
                      <blockquote className="border-l-2 border-rule pl-3 text-prose">
                        {citation.quote}
                      </blockquote>
                      <p className="mt-1 flex flex-wrap gap-x-3 text-micro uppercase tracking-label text-slate">
                        <span className="text-steady">{citation.sourceType}</span>
                        <span className="normal-case tracking-normal">
                          {titleFor(citation.documentId)}
                        </span>
                        {citation.section !== null && (
                          <span className="normal-case tracking-normal">
                            {citation.section}
                          </span>
                        )}
                        <span className="font-mono normal-case tracking-normal">
                          {citation.chunkId}
                        </span>
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-prose">
                Finding it here does not mean it does not matter.{" "}
                <Link href="/report/chat" className="text-steady hover:underline">
                  Report it anyway
                </Link>{" "}
                — how severe it was, and how often it happens, is what reviewers
                are watching for.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}

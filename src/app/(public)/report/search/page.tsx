import type { Metadata } from "next";
import Link from "next/link";
import { answerPublicQuestion } from "@/lib/assess/answer";
import { resolveAiBinding } from "@/lib/assess/ai";
import { aiEnv } from "@/lib/assess/env";
import { documentsForDrug } from "@/lib/assess/scope";
import { ensurePublicLabel, withAcquiredLabel } from "@/lib/labels/acquire";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { loadCorpus } from "@/lib/store/corpus";
import { GeneratedNarrative } from "@/components/narrative";
import { Orientation } from "@/components/report/orientation";
import { SourceDialog } from "@/components/source-dialog";
import { SourcePassage } from "@/components/source-passage";
import { passageContext } from "@/lib/library/context";
import { guardPublicSearch } from "@/lib/protection/guard";

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

export const metadata: Metadata = {
  title: "Is this a known side effect? — SideNote",
};
export default async function SearchPage({
  searchParams,
}: PageProps<"/report/search">) {
  const params = await searchParams;
  const raw = params["q"];
  const query = typeof raw === "string" ? raw.trim() : "";
  const rawDrug = params["drug"];
  const drug = typeof rawDrug === "string" ? rawDrug.trim() : "";

  /*
    Counted before a penny is spent.

    Checked here rather than deeper in, because everything expensive on this
    page is below this line: the label fetch, the embedding, and the
    generation. A limiter consulted after the work is a limiter that pays for
    the work it was meant to prevent.

    The form and the passages still render when the ceiling is hit — a reader
    who has just been told to wait a minute should not also lose the page.
  */
  const searching = query.length > 1 || drug.length > 2;
  const guard = searching ? await guardPublicSearch() : { allowed: true as const };

  /*
    The medicine is its own field, and that is a design decision rather than a
    form-layout preference.

    It used to be one box — "rash on both hands, Covaxil" — which was fine when
    the corpus was two invented products baked into the build. Now the medicine
    name decides which real FDA label gets fetched from openFDA, and guessing
    which word of a free-text sentence is a drug is the kind of extraction that
    fails quietly and fetches the wrong label. Asking is more honest than
    inferring, and it costs the reporter one field.
  */
  let acquisition = null;
  if (guard.allowed && drug.length > 2) {
    const env = await aiEnv();
    const held = (await loadCorpus()).documents;
    acquisition = await ensurePublicLabel({
      drugName: drug,
      held,
      dense: resolveDenseFor(env, resolveAiBinding(env)),
      actor: "public",
    });
  }

  // Loaded AFTER the fetch, so a label acquired a moment ago is searchable on
  // this same request rather than only on the next one.
  const { chunks, documents } = await loadCorpus();

  // Ask, retrieve, read. The answer and the passages it was read from arrive
  // together, so a claim can never render without the passage behind it.
  /*
    Scope the answer to the medicine the reporter named.

    Null only when they named none, in which case every public label is fair
    game because no product has been claimed. The moment a medicine IS named,
    answering from a different product's label would be the same wrong-product
    citation `scope.ts` exists to prevent — and here the reader is a member of
    the public, with no expertise to notice.

    Pinned with the label the fetch above actually resolved, so the page cannot
    announce a document and then refuse to search it. `documentsForDrug` alone
    could not match "ABACAVIR SULFATE" to a label filed under "abacavir", and
    the reporter was shown "Nothing found" about a label fetched seconds
    earlier.
  */
  const scope =
    drug.length > 2
      ? withAcquiredLabel(
          documentsForDrug(documents, {
            reportedName: drug,
            activeSubstance: null,
          }),
          acquisition,
        )
      : null;

  const answer =
    guard.allowed && query.length > 1
      ? await answerPublicQuestion(query, chunks, undefined, scope)
      : { citations: [], reading: null, hits: [], narrative: null };
  const hits = answer.citations;

  const titleFor = (documentId: string) =>
    documents.find((d) => d.id === documentId)?.title ?? "Unknown document";

  const { reading, narrative } = answer;

  /*
    "See in source" for a passage on this page too.

    A member of the public has less reason to take our word for a quotation
    than a reviewer does, not more. The context is computed here on the server
    from the corpus already loaded above, so the dialog can only show text this
    request actually holds.
  */
  const seeSource = (chunkId: string) => {
    const context = passageContext(chunks, documents, chunkId);
    if (context === null) return null;
    const span =
      reading?.status === "read" && reading.chunkId === chunkId
        ? reading.quotedSpan
        : null;
    return (
      <SourceDialog label="see in source">
        <SourcePassage
          context={context}
          span={span}
          labelSetId={context.chunk.documentId}
        />
      </SourceDialog>
    );
  };

  const answeredFrom =
    reading?.status === "read"
      ? hits.find((c) => c.chunkId === reading.chunkId) ?? null
      : null;

  return (
    <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 py-10">
      <h1 className="text-hero font-semibold">Is this a known side effect?</h1>
      <p className="mt-2.5 text-prose text-slate">
        Look up whether a side effect is already described in a medicine&rsquo;s
        published information. Only publicly available labels are searched, and
        this reports nothing.
      </p>

      <div className="mt-6">
        <Orientation />
      </div>

      <form
        method="get"
        className="mt-4 rounded-card border border-rule bg-surface p-5 shadow-card"
      >
        <div className="flex flex-wrap gap-4">
          <div className="w-full sm:w-[16rem]">
            <label htmlFor="drug" className="block text-body font-medium">
              Which medicine?
            </label>
            <input
              id="drug"
              name="drug"
              type="search"
              defaultValue={drug}
              placeholder="atorvastatin"
              className="mt-1.5 min-h-11 w-full rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
            />
          </div>

          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="block text-body font-medium">
              What happened?
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="my muscles ached all over"
                className="min-h-11 min-w-0 flex-1 rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
              />
              <button
                type="submit"
                className="min-h-11 cursor-pointer rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90"
              >
                Search
              </button>
            </div>
          </div>
        </div>

        {/*
          What naming the medicine actually does, and what was fetched because
          of it — one quiet note rather than a promise here and a result
          somewhere else on the page.
        */}
        <p className="mt-3 text-meta text-slate-quiet">
          Only publicly available labels are searched. Naming the medicine lets
          us fetch its FDA label if we do not already hold it.
          {acquisition !== null && acquisition.status !== "held" && (
            <>
              {" "}
              {acquisition.status === "acquired"
                ? `Fetched ${acquisition.title} from openFDA — ${acquisition.chunks} passages${acquisition.embedded ? ", indexed for semantic search" : ", keyword search only"}.`
                : acquisition.status === "not_found"
                  ? `${acquisition.reason}. Searching the labels already held.`
                  : `The FDA label service could not be reached, so only labels already held were searched.`}
            </>
          )}
        </p>
      </form>

      {/*
        The ceiling, when it is reached.

        `role="status"` because this page cannot answer 429 — it is a server
        component, and it deliberately keeps rendering the form and the
        passages rather than replacing them, so a reader told to wait a minute
        does not also lose what they were reading. That means the only signal
        a screen-reader user gets that their search did not run is this
        sentence, and it needs to announce rather than sit there.
      */}
      {!guard.allowed && (
        <p
          role="status"
          aria-live="polite"
          className="mt-6 rounded-card border border-rule bg-surface p-4 text-body shadow-card"
        >
          {guard.message}
        </p>
      )}

      {guard.allowed && query.length > 1 && (
        <section aria-label="Results" className="mt-6">

          {/*
            The generated answer. A few sentences, each quoting the passage
            numbered beside it — which is what makes it an answer over
            retrieved documents rather than a lifted quotation, and what lets a
            reader check every clause of it.

            Written in the plainest register the honesty rules allow: this is a
            worried person, not a reviewer.
          */}
          {narrative !== null && (
            <div className="rounded-card border border-rule bg-surface p-5 shadow-card">
              <p className="font-mono text-micro uppercase tracking-label text-slate">
                What the label says about{" "}
                {drug.length > 0 ? `${query} and ${drug}` : query}
              </p>
              <div className="mt-3">
                <GeneratedNarrative
                  narrative={narrative}
                  onSeeSource={seeSource}
                  about={drug.length > 0 ? `${query} and ${drug}` : query}
                  footnote="The sentences above were written by a computer. The words beneath each one were copied from the published label exactly as they appear there, so you can check them. This is not medical advice and not a decision about your medicine — speak to a doctor or pharmacist."
                />
              </div>
            </div>
          )}

          {/*
            The single verified quotation, when one could be produced. It sits
            above the passages because it is what was asked for — but it is
            never shown without them, and it quotes the label rather than
            paraphrasing it.
          */}
          {reading?.status === "read" && (
            <div className="mt-4 rounded-soft border-l-[3px] border-steady bg-surface-sunken px-4 py-3">
              <blockquote className="text-prose">{reading.quotedSpan}</blockquote>
              {reading.rationale !== null && (
                <p className="mt-2 text-body text-slate">{reading.rationale}</p>
              )}
              {answeredFrom !== null && (
                <p className="mt-2 flex flex-wrap gap-x-2 font-mono text-micro text-slate">
                  <span>{titleFor(answeredFrom.documentId)}</span>
                  {answeredFrom.section !== null && (
                    <span>· {answeredFrom.section}</span>
                  )}
                  <span>· {answeredFrom.chunkId}</span>
                  <span>{seeSource(answeredFrom.chunkId)}</span>
                </p>
              )}
              <p className="mt-2 text-meta text-slate-quiet">
                Quoted from the published label word for word. This is not
                medical advice and not a decision about your medicine — speak
                to a doctor or pharmacist.
              </p>
            </div>
          )}

          {reading?.status === "nothing_found" && (
            <div className="mt-4 rounded-card border border-rule bg-surface p-4 shadow-card">
              <p className="text-body">
                The passages below came up for what you described, but none of
                them appears to be about it. Read them and judge for yourself —
                it may be different wording for the same thing.
              </p>
            </div>
          )}

          {reading?.status === "unavailable" && (
            /* Dashed, not red. Missing information is not a warning. */
            <div className="mt-4 rounded-card border border-dashed border-rule p-4">
              <p className="text-body">
                We found passages that may be relevant but could not summarise
                them just now, so they are shown below exactly as written.
              </p>
            </div>
          )}

          {hits.length === 0 ? (
            <div className="mt-4 rounded-card border border-rule bg-surface p-5 shadow-card">
              <p className="text-body">
                No published label we hold describes that. That is not a
                verdict — it may simply be a medicine we do not have, or
                different wording.
              </p>
              <p className="mt-2 text-body">
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
              <div className="mt-4 rounded-card border border-rule bg-surface px-5 shadow-card">
                <p className="flex flex-wrap justify-between gap-x-3 border-b border-rule py-3 font-mono text-micro uppercase tracking-label text-slate">
                  <span>
                    {hits.length} passage{hits.length === 1 ? "" : "s"} searched
                  </span>
                  <span className="text-slate-quiet">public labels only</span>
                </p>
                <ul>
                  {hits.map((citation) => {
                    const quoted = citation.chunkId === answeredFrom?.chunkId;
                    return (
                      <li
                        key={citation.chunkId}
                        className="border-b border-rule py-4 last:border-b-0"
                      >
                        <blockquote
                          className={[
                            "pl-3 text-body",
                            quoted
                              ? "border-l-2 border-ink"
                              : "border-l-2 border-rule",
                          ].join(" ")}
                        >
                          {citation.quote}
                        </blockquote>
                        {/* A <div>: this row holds a <dialog>, which cannot sit inside a <p>. */}
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 pl-3 font-mono text-micro text-slate">
                          {quoted && (
                            <span className="text-ink">quoted above ·</span>
                          )}
                          <span className="text-steady">
                            {citation.sourceType}
                          </span>
                          <span>· {titleFor(citation.documentId)}</span>
                          {citation.section !== null && (
                            <span>· {citation.section}</span>
                          )}
                          <span>· {citation.chunkId}</span>
                          <span>{seeSource(citation.chunkId)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <p className="mt-4 rounded-card bg-steady-wash px-5 py-4 text-body">
                Finding it here does not mean it does not matter.{" "}
                <Link href="/report/chat" className="text-steady underline">
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

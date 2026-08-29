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
  if (drug.length > 2) {
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
    query.length > 1
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
    <main className="mx-auto w-full max-w-[70ch] px-4 py-8">
      <h1 className="text-title font-medium">Search known effects</h1>
      <p className="mt-2 text-prose text-slate">
        Look up whether a side effect is already described in a medicine&rsquo;s
        published information.
      </p>

      <div className="mt-4">
        <Orientation />
      </div>

      <form method="get" className="mt-5">
        <label htmlFor="drug" className="text-base font-medium">
          Which medicine?
        </label>
        <input
          id="drug"
          name="drug"
          type="search"
          defaultValue={drug}
          placeholder="atorvastatin"
          className="mt-1 w-full rounded-soft border border-rule bg-paper px-2 py-1.5 text-base focus:outline-2 focus:outline-offset-1 focus:outline-steady"
        />

        <label htmlFor="q" className="mt-4 block text-base font-medium">
          What happened?
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="my muscles ached all over"
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
          Only publicly available labels are searched. Naming the medicine lets
          us fetch its FDA label if we do not already hold it.
        </p>
      </form>

      {acquisition !== null && acquisition.status !== "held" && (
        <p className="mt-3 border-l-2 border-rule pl-3 text-meta text-slate">
          {acquisition.status === "acquired"
            ? `Fetched ${acquisition.title} from openFDA — ${acquisition.chunks} passages${acquisition.embedded ? ", indexed for semantic search" : ", keyword search only"}.`
            : acquisition.status === "not_found"
              ? `${acquisition.reason}. Searching the labels already held.`
              : `The FDA label service could not be reached, so only labels already held were searched.`}
        </p>
      )}

      {query.length > 1 && (
        <section aria-label="Results" className="mt-6">
          <h2 className="text-micro uppercase tracking-label text-slate">
            {hits.length === 0
              ? "Nothing found"
              : `${hits.length} passage${hits.length === 1 ? "" : "s"} searched`}
          </h2>

          {/*
            The generated answer. A few sentences, each quoting the passage
            numbered beside it — which is what makes it an answer over
            retrieved documents rather than a lifted quotation, and what lets a
            reader check every clause of it.

            Written in the plainest register the honesty rules allow: this is a
            worried person, not a reviewer.
          */}
          {narrative !== null && (
            <div className="mt-3 border-l-2 border-rule pl-3">
              <GeneratedNarrative
                narrative={narrative}
                onSeeSource={seeSource}
                footnote="Each sentence above quotes the label word for word — the exact words are numbered below it. This is not medical advice and not a decision about your medicine; speak to a doctor or pharmacist."
              />
            </div>
          )}

          {/*
            The single verified quotation, when one could be produced. It sits
            above the passages because it is what was asked for — but it is
            never shown without them, and it quotes the label rather than
            paraphrasing it.
          */}
          {reading?.status === "read" && (
            <div className="mt-2 border-l-2 border-steady pl-3">
              <blockquote className="text-prose">{reading.quotedSpan}</blockquote>
              {reading.rationale !== null && (
                <p className="mt-1.5 text-prose text-slate">{reading.rationale}</p>
              )}
              {answeredFrom !== null && (
                <p className="mt-1 flex flex-wrap gap-x-3 text-micro uppercase tracking-label text-slate">
                  <span className="normal-case tracking-normal">
                    {titleFor(answeredFrom.documentId)}
                  </span>
                  {answeredFrom.section !== null && (
                    <span className="normal-case tracking-normal">
                      {answeredFrom.section}
                    </span>
                  )}
                  <span className="font-mono normal-case tracking-normal">
                    {answeredFrom.chunkId}
                  </span>
                </p>
              )}
              <p className="mt-1.5 text-meta text-slate">
                Quoted from the published label word for word. This is not
                medical advice and not a decision about your medicine — speak
                to a doctor or pharmacist.
              </p>
            </div>
          )}

          {reading?.status === "nothing_found" && (
            <div className="mt-2 border border-rule p-3 rounded-soft">
              <p className="text-prose">
                The passages below came up for what you described, but none of
                them appears to be about it. Read them and judge for yourself —
                it may be different wording for the same thing.
              </p>
            </div>
          )}

          {reading?.status === "unavailable" && (
            /* Dashed, not red. Missing information is not a warning. */
            <div className="mt-2 border border-dashed border-rule p-3 rounded-soft">
              <p className="text-prose">
                We found passages that may be relevant but could not summarise
                them just now, so they are shown below exactly as written.
              </p>
            </div>
          )}

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
                {hits.map((citation) => {
                  const quoted = citation.chunkId === answeredFrom?.chunkId;
                  return (
                    <li key={citation.chunkId} className="border-b border-rule py-3">
                      <blockquote
                        className={[
                          "border-l-2 pl-3 text-prose",
                          quoted ? "border-ink" : "border-rule",
                        ].join(" ")}
                      >
                        {citation.quote}
                      </blockquote>
                      {/* A <div>: this row holds a <dialog>, which cannot sit inside a <p>. */}
                      <div className="mt-1 flex flex-wrap gap-x-3 text-micro uppercase tracking-label text-slate">
                        {quoted && <span className="text-ink">quoted above</span>}
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
                        <span className="normal-case tracking-normal">
                          {seeSource(citation.chunkId)}
                        </span>
                      </div>
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

/**
 * The public-side loading state.
 *
 * `/report/search` can legitimately take several seconds — it may fetch a
 * label from openFDA, chunk it, embed it and run a model over the result — and
 * with no boundary here the browser simply sat on the previous page with no
 * indication anything was happening. People press the button again, which is
 * how one search becomes four.
 *
 * Deliberately plain text rather than a spinner or a skeleton. A skeleton
 * promises a shape, and what comes back may be "nothing found", which is a
 * different shape and a legitimate answer.
 */
export default function PublicLoading() {
  return (
    <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 py-10">
      <p className="text-prose text-slate">Looking this up…</p>
      <p className="mt-2 text-meta text-slate-quiet">
        Published labels are fetched and read when a medicine is named, so this
        can take a few seconds the first time.
      </p>
    </main>
  );
}

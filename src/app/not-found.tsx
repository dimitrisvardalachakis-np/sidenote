import Link from "next/link";

/**
 * The 404, for both sides of the app.
 *
 * At the root rather than per route group, because a URL that matches no route
 * belongs to neither group — Next has nothing to tell it apart with, and a
 * not-found inside `(app)` would put the reviewer chrome around a stranger's
 * mistyped link.
 *
 * The two exits are offered without guessing which reader this is. A reviewer
 * who mistypes a case reference and a member of the public following a stale
 * link arrive at the identical URL.
 */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 py-16">
      <p className="font-mono text-micro uppercase tracking-label text-slate">
        Not found
      </p>
      <h1 className="mt-2 text-hero font-semibold">
        There is nothing at this address
      </h1>
      <p className="mt-2.5 text-prose text-slate">
        The link may be out of date, or a case reference may have been mistyped.
        Nothing has been deleted — this address simply never existed.
      </p>

      <div className="mt-6 flex flex-wrap gap-4">
        <Link href="/queue" className="text-body text-steady hover:underline">
          The reviewer queue
        </Link>
        <Link href="/report" className="text-body text-steady hover:underline">
          Report a side effect
        </Link>
      </div>
    </main>
  );
}

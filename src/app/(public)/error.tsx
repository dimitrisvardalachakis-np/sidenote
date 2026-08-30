"use client";

import { useEffect } from "react";

/**
 * The public-side error boundary.
 *
 * There was none, and `/report/search` sits under here calling openFDA and a
 * model with nothing above it — so an openFDA timeout took a member of the
 * public to Next's default error screen, which says nothing, offers nothing,
 * and looks like the site is broken.
 *
 * WRITTEN FOR A DIFFERENT READER THAN THE (app) ONE. A reviewer who hits an
 * error is at work and wants the digest. Somebody reporting that their mother
 * turned yellow is not debugging our software; the thing they need to know is
 * that their report was not lost and how to finish it. So the digest is still
 * shown — whoever they ring needs it — but it is at the bottom, and the first
 * sentence is about their report rather than about us.
 *
 * Not --signal red. That means expedited or overdue and nothing else.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      "[AUDIT]",
      JSON.stringify({
        actor: "public",
        action: "render_error",
        target: "public_route",
        timestamp: new Date().toISOString(),
        outcome: "failure",
      }),
    );
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 py-10">
      <h1 className="text-hero font-semibold">This page did not load</h1>
      <p className="mt-2.5 text-prose text-slate">
        Something on our side failed. Nothing you typed has been sent, and
        nothing you had already saved has been lost.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 cursor-pointer rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90"
        >
          Try again
        </button>
        <a href="/report" className="text-body text-steady hover:underline">
          Go to the report form
        </a>
      </div>

      <p className="mt-8 rounded-card bg-steady-wash px-5 py-4 text-body">
        If you are reporting something serious and this keeps happening, please
        contact your doctor or pharmacist directly — they can file the report
        for you. Do not wait on this page.
      </p>

      {error.digest !== undefined && (
        <p className="mt-6 font-mono text-micro text-slate-quiet">
          Reference: {error.digest}
        </p>
      )}
    </main>
  );
}

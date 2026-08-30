"use client";

import { useEffect } from "react";

/**
 * The reviewer-side error boundary.
 *
 * Two rules shape this. First, it must not use --signal: the red means
 * expedited or overdue, and an app error is neither. A reviewer who learns
 * that red sometimes means "a page broke" will hesitate the day it means a
 * report is late. Second, it says what failed and offers a way on, because a
 * dead end here means a case nobody is triaging.
 *
 * `digest` is the server-side error id Next attaches to production errors. It
 * is shown because "something went wrong" with no handle is unactionable for
 * whoever is asked to look into it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Cluster F replaces this with the structured audit sink.
    console.error("[AUDIT]", JSON.stringify({
      actor: "system",
      action: "render_error",
      target: "app_route",
      timestamp: new Date().toISOString(),
      outcome: "failure",
    }));
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10">
      <h1 className="text-h1 font-medium">This screen could not load</h1>
      <p className="mt-2 text-prose text-slate">
        Nothing was saved or changed. The case is untouched.
      </p>

      <hr className="my-6" />

      <p className="text-base">{error.message || "No further detail."}</p>
      {error.digest !== undefined && (
        <p className="mt-2 font-mono text-meta text-slate">
          Reference: {error.digest}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="cursor-pointer rounded-soft border border-rule px-3 py-1.5 text-base hover:bg-surface-sunken hover:text-steady"
        >
          Try again
        </button>
        <a
          href="/queue"
          className="text-base text-steady hover:underline"
        >
          Back to the queue
        </a>
      </div>
    </div>
  );
}

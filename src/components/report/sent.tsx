"use client";

import Link from "next/link";

/**
 * What happens after the report is sent.
 *
 * The confirmation was well written and it dead-ended: a reference number and
 * a "Report something else" button. Somebody who has just described the worst
 * week of their year is left holding a number with nothing to do next.
 *
 * Four things now, in the order they matter: keep the number, find out what
 * happens next, check whether this reaction is already described (which is
 * thematically the obvious next question and is one click away), and only then
 * the option to report something else.
 */
export function SentConfirmation({
  reference,
  caseId,
  medicineName,
  onReportAnother,
}: {
  reference: string;
  caseId: string;
  /** Pre-fills the lookup, so it is one click rather than typing it again. */
  medicineName: string | null;
  onReportAnother: () => void;
}) {
  const lookup =
    medicineName === null
      ? "/report/search"
      : `/report/search?drug=${encodeURIComponent(medicineName)}`;

  return (
    <div>
      <h2 className="text-h2 font-medium">Thank you. Your report is in.</h2>
      <p className="mt-2 text-prose">
        A trained person reads every report. You do not need to do anything
        else.
      </p>

      <div className="mt-5 rounded-soft border border-rule p-4">
        <p className="text-micro uppercase tracking-label text-slate">
          Your reference number
        </p>
        <p className="mt-1 font-mono text-figure">{reference}</p>
        <p className="mt-3 text-prose">
          Please write this down or take a picture of it. Say this number if you
          ever contact us about this report.
        </p>
        {/*
          `window.print()` rather than a download: it is the one save-a-page
          affordance every browser has, it works on a phone, and it needs no
          new dependency. A button rather than an instruction, because "press
          Ctrl+P" is not something to tell a frightened person.
        */}
        <button
          type="button"
          onClick={() => window.print()}
          className="mt-3 cursor-pointer rounded-soft border border-rule px-3 py-1 text-meta hover:bg-row-hover"
        >
          Save or print this page
        </button>
      </div>

      <section aria-label="What happens next" className="mt-6">
        <h3 className="text-base font-medium">What happens next</h3>
        <p className="mt-1 text-prose">
          A safety reviewer will compare what you described against the
          medicine&rsquo;s safety documents. If you gave us a way to reach you
          and said we may, someone may contact you to ask one or two more
          questions. Otherwise you will not hear back, and that does not mean
          nothing happened — most reports are used as one of many.
        </p>
      </section>

      <section aria-label="Look it up" className="mt-5">
        <h3 className="text-base font-medium">
          Is this already a known side effect?
        </h3>
        <p className="mt-1 text-prose">
          You can look up whether{" "}
          {medicineName === null ? "the medicine" : medicineName}&rsquo;s
          published information already describes what happened.{" "}
          <Link href={lookup} className="text-steady hover:underline">
            Look it up
          </Link>
          . Finding it there does not mean your report was unnecessary — how
          severe it was, and how often it happens, is what reviewers watch for.
        </p>
      </section>

      <p className="mt-6 text-meta text-slate">
        This is a training demo, so here is the reviewer view of what you just
        sent:{" "}
        <Link
          href={`/case/${caseId}`}
          className="text-steady hover:underline"
        >
          see the case
        </Link>
        . A real reporter would not have that link.
      </p>

      <button
        type="button"
        onClick={onReportAnother}
        className="mt-4 cursor-pointer rounded-soft border border-rule px-4 py-2 text-base hover:bg-row-hover"
      >
        Report something else
      </button>
    </div>
  );
}

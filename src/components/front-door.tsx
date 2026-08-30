"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SignInForm } from "./signin-form";

/**
 * One question at the front door: which of you is this?
 *
 * The page used to offer two cards and a quieter third link, so a frightened
 * person's first task was to compare three user interfaces. It asks one
 * question now, and the panel beside it becomes the door for the answer —
 * so choosing costs a glance rather than a decision, and changing your mind
 * costs nothing.
 *
 * A REAL RADIO GROUP, not three buttons. Arrow keys move between the rows,
 * the group is one tab stop, and the selected row is the one that is tabbable
 * — which is what a screen reader expects of a set of mutually exclusive
 * choices and what a keyboard user gets for free everywhere else.
 *
 * The selection is component state and deliberately not in the URL. It is not
 * a place in the app; it is which of three doors you are standing in front of,
 * and putting it in the address bar would put a stranger's answer in a link
 * somebody shared.
 */

type Role = "report" | "reviewer" | "lookup";

const ROLES: readonly {
  readonly id: Role;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    id: "report",
    label: "Something happened after a medicine",
    hint: "For a patient, a carer, or anyone reporting on someone else's behalf.",
  },
  {
    id: "reviewer",
    label: "I review safety cases",
    hint: "The triage queue. Access is granted by your safety lead.",
  },
  {
    id: "lookup",
    label: "I only want to look something up",
    hint: "Check the published information for a medicine. Reports nothing.",
  },
];

export function FrontDoor() {
  const [role, setRole] = useState<Role>("report");
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  /*
    Arrow keys move the selection AND the focus together, which is how a radio
    group behaves natively. Home and End are included because a three-item
    group is exactly the size where jumping to an end is faster than stepping.
  */
  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = ROLES.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }
    if (next === null) return;
    event.preventDefault();
    const chosen = ROLES[next];
    if (chosen === undefined) return;
    setRole(chosen.id);
    rows.current[next]?.focus();
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
      <div className="min-w-0">
        <p className="font-mono text-micro uppercase tracking-label text-steady">
          Pharmacovigilance case triage
        </p>
        <h1 className="mt-3 text-display font-semibold">
          Is this side effect already known?
        </h1>
        <p className="mt-4 max-w-[46ch] text-prose text-slate">
          SideNote reads the company safety document and the public FDA label,
          puts the two passages side by side with citations, and leaves the
          decision to a trained reviewer. If a serious reaction is new, the
          regulator has to be told within 15 days.
        </p>

        <h2 className="mt-8 font-mono text-micro uppercase tracking-label text-slate">
          Which are you?
        </h2>
        <div
          role="radiogroup"
          aria-label="Which are you?"
          className="mt-3 flex flex-col gap-2"
        >
          {ROLES.map((option, index) => {
            const current = role === option.id;
            return (
              <button
                key={option.id}
                ref={(node) => {
                  rows.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={current}
                tabIndex={current ? 0 : -1}
                onClick={() => setRole(option.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={[
                  "w-full cursor-pointer rounded-card border-l-[3px] px-4 py-3 text-left",
                  current
                    ? "border-l-steady bg-surface shadow-card"
                    : "border-l-transparent bg-transparent hover:bg-surface",
                ].join(" ")}
              >
                <span
                  className={[
                    "block text-body font-medium",
                    current ? "text-ink" : "text-slate",
                  ].join(" ")}
                >
                  {option.label}
                </span>
                <span className="mt-0.5 block text-meta text-slate">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-card border border-rule bg-surface p-6 shadow-float">
        {role === "report" && <ReportDoor />}
        {role === "reviewer" && <ReviewerDoor />}
        {role === "lookup" && <LookupDoor />}
      </div>
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-micro uppercase tracking-label text-slate">
      {children}
    </p>
  );
}

function ReportDoor() {
  return (
    <div>
      <Kicker>Reporting a side effect</Kicker>
      <h3 className="mt-2 text-h1 font-semibold">Report a side effect</h3>
      <p className="mt-2.5 text-body text-slate">
        Tell us what happened in your own words. No account, about five minutes,
        and you can leave anything blank.
      </p>

      {/*
        An example in the reporter's own register, so the first thing they see
        is that ordinary words are what this form wants.
      */}
      <p className="mt-4 rounded-soft bg-surface-sunken px-3 py-2.5 text-body text-slate">
        &ldquo;Mum started a new tablet on Tuesday and by Friday her eyes had
        gone yellow…&rdquo;
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href="/report"
          className="flex min-h-11 items-center rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90"
        >
          Start a report
        </Link>
        <span className="text-meta text-slate">
          or{" "}
          <Link href="/report/chat" className="text-steady hover:underline">
            answer by chat
          </Link>
        </span>
      </div>

      {/*
        The emergency line as the footnote of this panel rather than a banner
        over the page. It is the most important sentence here and it is also
        the one that must not shout at somebody who is already frightened.
      */}
      <p className="mt-5 border-t border-rule pt-4 text-meta text-slate">
        If this is happening now and it is serious — chest pain, trouble
        breathing, swelling of the face or throat, fainting — contact a doctor
        or your local emergency services. This form is not monitored in real
        time.
      </p>
    </div>
  );
}

function ReviewerDoor() {
  return (
    <div>
      <Kicker>Reviewer access</Kicker>
      <h3 className="mt-2 text-h1 font-semibold">Open the queue</h3>
      <p className="mt-2.5 text-body text-slate">
        Cases sorted by how close they are to the 15-day deadline, with both
        sources retrieved and the disagreements flagged.
      </p>
      <div className="mt-5">
        <SignInForm submitLabel="Sign in as reviewer" />
      </div>
      <p className="mt-4 border-t border-rule pt-4 text-meta text-slate">
        Cases are confidential — nothing from the queue is visible until you are
        signed in. Access is granted by your safety lead.
      </p>
    </div>
  );
}

function LookupDoor() {
  return (
    <form method="get" action="/report/search">
      <Kicker>Looking something up</Kicker>
      <h3 className="mt-2 text-h1 font-semibold">Is this a known effect?</h3>
      <p className="mt-2.5 text-body text-slate">
        Searches the published information for a medicine. It does not report
        anything, and finding it there does not mean it does not matter.
      </p>

      <label htmlFor="front-drug" className="mt-5 block text-body font-medium">
        Which medicine?
      </label>
      <input
        id="front-drug"
        name="drug"
        type="search"
        placeholder="atorvastatin"
        className="mt-1.5 min-h-11 w-full rounded-soft border border-rule bg-surface px-3 py-2 text-body placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
      />

      <button
        type="submit"
        className="mt-4 flex min-h-11 items-center rounded-soft bg-steady px-5 py-2 text-body font-medium text-surface hover:opacity-90"
      >
        Look up
      </button>

      <div className="mt-5 border-t border-rule pt-4">
        <Kicker>For example</Kicker>
        <ul className="mt-2 flex flex-wrap gap-2">
          {["atorvastatin", "Hepalex", "Covaxil"].map((example) => (
            <li key={example}>
              <Link
                href={`/report/search?drug=${encodeURIComponent(example)}`}
                className="flex min-h-8 items-center rounded-pill border border-rule px-3 py-1 text-meta text-slate hover:border-steady-line hover:text-steady"
              >
                {example}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}

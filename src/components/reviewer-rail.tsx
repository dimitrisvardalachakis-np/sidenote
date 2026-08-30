"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { JumpToCase } from "./jump-to-case";
import { ThemeToggle } from "./theme-toggle";

/**
 * The reviewer's navigation. Reviewer things only.
 *
 * It used to carry both audiences at all times, which meant a patient filling
 * in a form was looking at somebody's internal tool, and a reviewer's own
 * identity was small grey text in a corner of one page. Both areas are still
 * reachable from either chrome — that was a deliberate decision and it is
 * right — but the area you are in is dominant now and the other one is a
 * single quiet way across, at the bottom.
 *
 * Below `lg` the rail becomes a top bar and the nav collapses behind a
 * disclosure. Above it, nothing has changed: the same 236px sticky column.
 * The two are one component with one set of links rather than a desktop menu
 * and a mobile menu that drift apart.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
}

const REVIEWER: readonly NavItem[] = [
  { href: "/queue", label: "Queue", hint: "Cases waiting" },
  { href: "/library", label: "Library", hint: "Safety documents" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** What the collapsed top bar names, so you know where you are before opening it. */
function areaOf(pathname: string): string {
  if (isActive(pathname, "/library")) return "Library";
  if (pathname.startsWith("/case/")) return "Case";
  return "Queue";
}

export function ReviewerRail({
  displayName,
  reviewerId,
  reviewers,
  signOut,
  switchReviewer,
}: {
  displayName: string;
  reviewerId: string;
  /** The identities this demo can wear. Standing in for real accounts. */
  reviewers: readonly { id: string; displayName: string }[];
  /** Bound server actions, so this stays a client component with no auth import. */
  signOut: () => Promise<void>;
  switchReviewer: (form: FormData) => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navId = useId();

  return (
    <nav
      aria-label="Reviewer"
      className="shrink-0 border-b border-rule bg-surface lg:w-[236px] lg:border-r lg:border-b-0"
    >
      <div className="flex flex-col lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-2 border-rule px-3 py-2 lg:block lg:border-b lg:py-3">
          <Link href="/queue" className="min-w-0">
            <span className="block text-base font-medium">SideNote</span>
            <span className="mt-0.5 block text-micro uppercase tracking-label text-slate">
              Reviewer
            </span>
          </Link>

          {/*
            Only exists below lg. `lg:hidden` is display:none, which takes it
            out of the accessibility tree too, so aria-expanded never describes
            a control that is not there.
          */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={navId}
            onClick={() => setOpen((v) => !v)}
            className="flex shrink-0 items-center gap-2 rounded-soft border border-rule px-2 py-1 text-micro uppercase tracking-label text-slate hover:border-steady hover:text-steady lg:hidden"
          >
            <span className="text-ink">{areaOf(pathname)}</span>
            <span aria-hidden="true">{open ? "▲" : "▼"}</span>
            <span className="sr-only">navigation</span>
          </button>
        </div>

        {/*
          One panel, two behaviours. Below lg the disclosure decides; at lg and
          above `lg:block` wins regardless, so the rail cannot be left in a
          collapsed state by a window resize.
        */}
        <div
          id={navId}
          className={[open ? "block" : "hidden", "lg:block"].join(" ")}
        >
          <ul className="py-2">
            {REVIEWER.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={[
                      "block border-l-2 px-3 py-1.5",
                      active
                        ? "border-steady bg-steady-wash"
                        : "border-transparent hover:bg-row-hover",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "block text-base",
                        active ? "text-steady" : "text-ink",
                      ].join(" ")}
                    >
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-micro text-slate">
                      {item.hint}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-rule">
            <JumpToCase />
          </div>

          {/*
            The footer group: who you are, the way across to the public form,
            and the theme control — in that order, because that is the order in
            which a reviewer is likely to want them, and it is the reverse of
            how they were weighted before.
          */}
          <div className="border-t border-rule px-3 py-2">
            <p className="text-micro uppercase tracking-label text-slate">
              Signed in as
            </p>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-meta text-ink">
                {displayName}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="cursor-pointer text-micro uppercase tracking-label text-slate hover:text-steady hover:underline"
                >
                  Sign out
                </button>
              </form>
            </div>

            {/*
              The identity switcher, standing in for real accounts.

              It is here rather than hidden behind a flag because the screen it
              makes reachable — a case already held by a colleague — is the one
              CLAUDE.md calls the central conflict this app exists to resolve,
              and with a single identity it cannot be reached at all. Labelled
              for what it is, so nobody mistakes it for authentication.
            */}
            <form action={switchReviewer} className="mt-3">
              <label
                htmlFor="reviewer-switch"
                className="block text-micro uppercase tracking-label text-slate"
              >
                Act as
              </label>
              <select
                id="reviewer-switch"
                name="reviewerId"
                /*
                  `key` forces a remount when the identity changes. A
                  `defaultValue` is only read when the node is created, so
                  without this the select kept showing the previous reviewer
                  after a switch — the rail above it said one name and the
                  control said another.
                */
                key={reviewerId}
                defaultValue={reviewerId}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="mt-1 w-full rounded-soft border border-rule bg-surface px-2 py-1 text-meta focus:outline-2 focus:outline-offset-1 focus:outline-steady"
              >
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.displayName}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-micro text-slate">
                Stands in for real accounts. There is no password in this build.
              </p>
            </form>

            <Link
              href="/report"
              className="mt-3 block text-meta text-slate hover:text-steady hover:underline"
            >
              Public report form →
            </Link>

            <div className="mt-3">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

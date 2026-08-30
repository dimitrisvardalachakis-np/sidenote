"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { JumpToCase } from "./jump-to-case";
import { DemoNotice } from "./demo-banner";
import { ThemeMenu } from "./theme-toggle";

/**
 * The reviewer's navigation. Reviewer things only.
 *
 * A patient filling in the public form never renders this — that is what the
 * route groups are for. Both areas stay reachable from either chrome, which
 * was a deliberate decision and is right, but the area you are in is dominant
 * and the other one is a single quiet way across at the bottom.
 *
 * Below `lg` the rail becomes a top bar and the nav collapses behind a
 * disclosure. Above it, a 232px sticky column on --surface, standing on the
 * --paper page. The two are one component with one set of links rather than a
 * desktop menu and a mobile menu that drift apart.
 *
 * The identity switcher that used to sit in this footer is GONE. It was a
 * Server Action that changed who you were with no credential — harmless while
 * signing in was itself a single click, and a hole the moment sign-in started
 * asking for a password. Wearing a different identity is now sign out, other
 * address, same shared password.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** What the collapsed top bar names, so you know where you are before opening it. */
function areaOf(pathname: string): string {
  if (isActive(pathname, "/library")) return "Library";
  if (pathname.startsWith("/case/")) return "Case";
  return "Queue";
}

const REVIEWER: readonly NavItem[] = [
  { href: "/queue", label: "Queue" },
  { href: "/library", label: "Library" },
];

export function ReviewerRail({
  displayName,
  signOut,
  caseCount,
  overdueCount,
}: {
  displayName: string;
  /** A bound server action, so this stays a client component with no auth import. */
  signOut: () => Promise<void>;
  caseCount: number;
  overdueCount: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navId = useId();

  /*
    The count line under Queue. Assembled here rather than passed as a string
    so the plural and the "· N overdue" clause are decided once, and so a
    queue with nothing late says nothing about overdue rather than saying
    zero — a standing "0 overdue" is a number the eye stops reading, and this
    is the line that has to still register on the day it says one.
  */
  const queueHint =
    `${caseCount} ${caseCount === 1 ? "case" : "cases"}` +
    (overdueCount > 0 ? ` · ${overdueCount} overdue` : "");

  const hintFor = (href: string) =>
    href === "/queue" ? queueHint : "Safety documents";

  return (
    <nav
      aria-label="Reviewer"
      className="shrink-0 border-b border-rule bg-surface lg:w-[232px] lg:border-r lg:border-b-0"
    >
      <div className="flex flex-col lg:sticky lg:top-0 lg:max-h-screen lg:min-h-screen lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-2 px-4 py-3 lg:block lg:border-b lg:border-rule lg:py-4">
          <Link href="/queue" className="flex min-w-0 items-center gap-2.5">
            {/* The mark. A shape, not a logotype — this is a demo build. */}
            <span
              aria-hidden="true"
              className="size-5 shrink-0 rounded-[6px] bg-steady"
            />
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-tight">
                SideNote
              </span>
              <span className="block font-mono text-micro uppercase tracking-label text-slate">
                Reviewer
              </span>
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
            className="flex min-h-9 shrink-0 items-center gap-2 rounded-soft border border-rule px-3 py-1 font-mono text-micro uppercase tracking-label text-slate hover:border-steady-line hover:text-steady lg:hidden"
          >
            <span className="text-ink">{areaOf(pathname)}</span>
            <span aria-hidden="true">{open ? "▲" : "▼"}</span>
            <span className="sr-only">navigation</span>
          </button>
        </div>

        {/*
          One panel, two behaviours. Below lg the disclosure decides; at lg and
          above `lg:flex` wins regardless, so the rail cannot be left in a
          collapsed state by a window resize.
        */}
        <div
          id={navId}
          className={[
            open ? "flex" : "hidden",
            "flex-1 flex-col lg:flex",
          ].join(" ")}
        >
          <ul className="px-3 py-3">
            {REVIEWER.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="mt-1 first:mt-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={[
                      "block rounded-[9px] px-3 py-2",
                      active
                        ? "bg-steady-wash"
                        : "hover:bg-surface-sunken",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "block text-base font-medium",
                        active ? "text-steady" : "text-ink",
                      ].join(" ")}
                    >
                      {item.label}
                    </span>
                    <span
                      className={[
                        "mt-0.5 block text-meta",
                        active ? "text-steady" : "text-slate",
                      ].join(" ")}
                    >
                      {hintFor(item.href)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="px-3">
            <JumpToCase />
          </div>

          {/*
            The footer, pushed to the bottom of the column by the spacer above
            it: who you are, the way across to the public form, the theme
            control behind a disclosure, and the demo notice as the quietest
            line on the screen. That last one is non-negotiable #10 on every
            reviewer page, and it is quiet rather than absent.
          */}
          <div className="mt-auto border-t border-rule px-4 py-3">
            <p className="font-mono text-micro uppercase tracking-label text-slate">
              Signed in as
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-base text-ink">
                {displayName}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="cursor-pointer font-mono text-micro uppercase tracking-label text-slate hover:text-steady hover:underline"
                >
                  Sign out
                </button>
              </form>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <Link
                href="/report"
                className="text-meta text-slate hover:text-steady hover:underline"
              >
                Public report form →
              </Link>
              <ThemeMenu />
            </div>

            <DemoNotice className="mt-3" />
          </div>
        </div>
      </div>
    </nav>
  );
}

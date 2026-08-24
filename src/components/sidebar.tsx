"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

/**
 * The persistent navigation.
 *
 * Two areas, always both visible: the person reporting a side effect, and the
 * reviewer who triages it. Showing both at all times rather than swapping the
 * menu is deliberate — this is one tool with two jobs, and a reviewer
 * frequently wants to see what a reporter sees. It also means the menu never
 * moves under you, which is the thing that makes a sidebar feel solid.
 *
 * Laid out like documentation rather than an app chrome: a quiet left rail,
 * grouped headings, and the content column doing the work. That is the
 * "instrument panel, not a landing page" instruction applied to navigation.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
}

const REPORTER: readonly NavItem[] = [
  {
    href: "/report/chat",
    label: "Report by chat",
    hint: "Describe it in your own words",
  },
  {
    href: "/report/search",
    label: "Search known effects",
    hint: "Is this already recorded?",
  },
  { href: "/report", label: "Report by form", hint: "The long form" },
];

const REVIEWER: readonly NavItem[] = [
  { href: "/queue", label: "Queue", hint: "Cases waiting" },
  { href: "/library", label: "Library", hint: "Safety documents" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/report") return pathname === "/report";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroup({
  heading,
  note,
  items,
  pathname,
}: {
  heading: string;
  note: string;
  items: readonly NavItem[];
  pathname: string;
}) {
  return (
    <div className="mt-5 first:mt-0">
      <h2 className="px-3 text-micro uppercase tracking-label text-slate">
        {heading}
      </h2>
      <p className="mt-0.5 px-3 text-micro text-slate">{note}</p>
      <ul className="mt-1.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
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
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const atRoot = pathname === "/";

  return (
    <nav
      aria-label="Sections"
      className="flex w-[236px] shrink-0 flex-col border-r border-rule bg-paper"
    >
      <div className="sticky top-0 flex max-h-screen flex-col overflow-y-auto">
        <Link href="/" className="block px-3 py-3 hover:bg-row-hover">
          <span className="block text-base font-medium">SideNote</span>
          <span className="mt-0.5 block text-micro uppercase tracking-label text-slate">
            Drug safety triage
          </span>
        </Link>

        {/*
          The back control. Present whenever you are inside an area, absent at
          the root where there is nothing to go back to. Its slot is reserved
          either way so the menu below it never shifts position.
        */}
        <div className="border-y border-rule">
          {atRoot ? (
            <p className="px-3 py-1.5 text-micro uppercase tracking-label text-slate">
              Choose an area
            </p>
          ) : (
            <Link
              href="/"
              className="block px-3 py-1.5 text-micro uppercase tracking-label text-slate hover:bg-row-hover hover:text-ink"
            >
              ← All areas
            </Link>
          )}
        </div>

        <div className="flex-1 py-3">
          <NavGroup
            heading="Report a side effect"
            note="Patients, carers and clinicians"
            items={REPORTER}
            pathname={pathname}
          />
          <NavGroup
            heading="Reviewer"
            note="Signed-in safety reviewers"
            items={REVIEWER}
            pathname={pathname}
          />
        </div>

        <div className="border-t border-rule px-3 py-2">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

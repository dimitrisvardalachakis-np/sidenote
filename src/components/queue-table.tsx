"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clockLabel } from "./case-list";
import type { QueueRow } from "@/lib/queue/view";
import type { QueueSort } from "@/lib/queue/sort";
import { isTypingTarget, queueShortcut } from "@/lib/queue/shortcuts";

/**
 * The queue as a worklist.
 *
 * Rows were 92px tall in a 900px column, so at 1600px a third of the window
 * was empty margin while the drug and the reaction truncated inside it. This
 * is an aligned table at roughly 36px a row: rail, clock, reference, reaction,
 * drug, seriousness, listedness, status, age, owner.
 *
 * A client component, and only this leaf is. The page stays a Server Component
 * and does the filtering and sorting; what crosses the boundary is the rows it
 * has already computed. What lives here is the keyboard, which is the one
 * thing the server cannot do.
 *
 * THE KEYBOARD IS THE POINT. For a tool somebody lives in eight hours a day,
 * `j`/`k` to move and Enter to open is the loudest possible signal that it was
 * built for them. A roving `tabindex` with `aria-activedescendant`: one tab
 * stop for the whole table, arrows within it, which is what a listbox is for
 * and what a screen reader expects.
 */
export function QueueTable({
  rows,
  sort,
  sortHrefs,
  emptyMessage,
  clearHref,
}: {
  rows: readonly QueueRow[];
  sort: QueueSort;
  /**
   * One href per sortable column, precomputed on the server.
   *
   * Data rather than a `(sort) => string` callback: a function cannot cross
   * the Server/Client boundary, and the failure is a runtime error the build
   * does not catch. Four strings say the same thing and are serialisable.
   */
  sortHrefs: Readonly<Record<QueueSort, string>>;
  emptyMessage: string;
  /** Shown in the empty state when filters are hiding everything. */
  clearHref: string | null;
}) {
  const [cursor, setCursor] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // A filter or a search can shorten the list under the cursor.
  const active = Math.min(cursor, Math.max(0, rows.length - 1));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      /*
        The decision is `queueShortcut`, in lib, with its own tests. What lives
        here is only the reading of a real event into that shape and the doing
        of what it says — so the rules about when to stand down are checked by
        a test rather than by hoping this branch is right.
      */
      const target = event.target;
      const action = queueShortcut({
        key: event.key,
        withModifier: event.metaKey || event.ctrlKey || event.altKey,
        inField:
          target instanceof HTMLElement &&
          isTypingTarget({
            tagName: target.tagName,
            isContentEditable: target.isContentEditable,
          }),
        dialogOpen: document.querySelector("dialog[open]") !== null,
        hasRows: rows.length > 0,
      });

      switch (action.kind) {
        case "move":
          event.preventDefault();
          setCursor((c) =>
            Math.max(0, Math.min(c + action.delta, rows.length - 1)),
          );
          break;
        case "open": {
          const row = rows[Math.min(cursor, rows.length - 1)];
          if (row !== undefined) {
            event.preventDefault();
            // The router, not window.location: a client-side navigation keeps
            // the rail and the shell mounted, which is the difference between
            // moving through sixteen cases and reloading the app sixteen times.
            router.push(`/case/${row.record.id}`);
          }
          break;
        }
        case "toggle_help":
          event.preventDefault();
          setShowHelp((v) => !v);
          break;
        case "dismiss":
          setShowHelp(false);
          break;
        case "focus_search":
        case "none":
          // `focus_search` belongs to QueueSearch, which owns that input.
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rows, cursor, router]);

  // Keep the highlighted row on screen when it moves by keyboard.
  useEffect(() => {
    bodyRef.current
      ?.querySelector(`[data-row-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (rows.length === 0) {
    return (
      <div className="border-y border-rule px-3 py-8 text-center">
        <p className="text-base">{emptyMessage}</p>
        {clearHref !== null && (
          <p className="mt-2 text-meta">
            <Link href={clearHref} className="text-steady hover:underline">
              Clear the filters
            </Link>
          </p>
        )}
      </div>
    );
  }

  const activeId = `queue-row-${active}`;

  return (
    <div>
      {showHelp && <ShortcutSheet onClose={() => setShowHelp(false)} />}

      {/*
        A grid rather than a <table>: the row has to be one link target, and a
        <tr> cannot be wrapped in an <a>. Roles restore what the markup gives
        up, so it is still announced as a table with sortable columns.
      */}
      <div role="table" aria-label="Case queue" aria-rowcount={rows.length}>
        <div
          role="row"
          className="hidden border-b border-rule pb-1 lg:grid lg:grid-cols-[3px_5.5rem_9rem_1fr_9rem_4.5rem_5.5rem_6rem_3rem_7rem] lg:gap-x-3"
        >
          <span />
          <SortHeader
            column="clock"
            sort={sort}
            href={sortHrefs["clock"]}
            label="Clock"
          />
          <span role="columnheader" className={HEAD}>
            Reference
          </span>
          <span role="columnheader" className={HEAD}>
            Reaction
          </span>
          <SortHeader
            column="drug"
            sort={sort}
            href={sortHrefs["drug"]}
            label="Drug"
          />
          <span role="columnheader" className={HEAD}>
            Serious
          </span>
          <span role="columnheader" className={HEAD}>
            Listedness
          </span>
          <SortHeader
            column="status"
            sort={sort}
            href={sortHrefs["status"]}
            label="Status"
          />
          <SortHeader
            column="received"
            sort={sort}
            href={sortHrefs["received"]}
            label="Age"
          />
          <span role="columnheader" className={HEAD}>
            Owner
          </span>
        </div>

        <div
          ref={bodyRef}
          role="listbox"
          aria-label="Cases"
          aria-activedescendant={activeId}
          tabIndex={0}
          className="focus:outline-2 focus:outline-offset-2 focus:outline-steady"
        >
          {rows.map((row, index) => (
            <Row
              key={row.record.id}
              row={row}
              index={index}
              active={index === active}
              onFocus={() => setCursor(index)}
            />
          ))}
        </div>
      </div>

      <p className="mt-2 text-micro text-slate">
        <kbd className="font-mono">j</kbd> / <kbd className="font-mono">k</kbd>{" "}
        to move, <kbd className="font-mono">Enter</kbd> to open,{" "}
        <kbd className="font-mono">/</kbd> to search,{" "}
        <kbd className="font-mono">?</kbd> for all shortcuts.
      </p>
    </div>
  );
}

const HEAD = "text-micro uppercase tracking-label text-slate";

function SortHeader({
  column,
  sort,
  href,
  label,
}: {
  column: QueueSort;
  sort: QueueSort;
  href: string;
  label: string;
}) {
  const current = sort === column;
  return (
    <span
      role="columnheader"
      // The sort lives in the URL, so this is genuinely a link: it can be
      // bookmarked, opened in a new tab, and works with JavaScript off.
      aria-sort={current ? "ascending" : "none"}
      className={HEAD}
    >
      <Link
        href={href}
        className={current ? "text-ink" : "hover:text-ink"}
      >
        {label}
        {current && <span aria-hidden="true"> ↓</span>}
      </Link>
    </span>
  );
}

function Row({
  row,
  index,
  active,
  onFocus,
}: {
  row: QueueRow;
  index: number;
  active: boolean;
  onFocus: () => void;
}) {
  const clock = row.clock;
  const label =
    clock === null
      ? { text: row.serious ? "assess now" : "not assessed", urgent: false }
      : clockLabel(clock);

  return (
    <Link
      href={`/case/${row.record.id}`}
      id={`queue-row-${index}`}
      data-row-index={index}
      role="option"
      aria-selected={active}
      // One tab stop for the table, arrows within it. A roving tabindex is
      // what stops sixteen cases becoming sixteen tab stops.
      tabIndex={-1}
      onMouseEnter={onFocus}
      className={[
        "grid grid-cols-[3px_1fr] items-baseline gap-x-3 border-b border-rule py-1.5",
        "lg:grid-cols-[3px_5.5rem_9rem_1fr_9rem_4.5rem_5.5rem_6rem_3rem_7rem]",
        active ? "bg-row-active" : "hover:bg-row-hover",
      ].join(" ")}
    >
      {/*
        The rail is the left edge of the row, not a badge: a reviewer scanning
        a queue reads down the left margin, so urgency there is legible without
        reading a word and costs no horizontal space.
      */}
      {/*
        Below lg only three cells are visible — rail, clock, reaction — and a
        two-column grid places the third back in column one, which is 3px
        wide. The rail spans both rows and the reaction is pinned to column
        two, so the narrow layout is two stacked lines beside one rail rather
        than a reaction clipped to a sliver.
      */}
      <span
        aria-hidden="true"
        className={[
          "row-span-2 h-full w-[3px] self-stretch lg:row-span-1",
          clock !== null && clock.state !== "not_applicable"
            ? "bg-signal"
            : "bg-transparent",
        ].join(" ")}
      />

      <span
        className={[
          "text-meta tabular-nums",
          label.urgent ? "text-signal" : "text-slate",
        ].join(" ")}
      >
        {label.text}
      </span>

      <span className="hidden font-mono text-meta text-slate lg:block">
        {row.record.reference}
        {row.isNew && (
          <span className="ml-1 text-steady" title="Arrived since your last visit">
            •
          </span>
        )}
      </span>

      <span className="col-start-2 min-w-0 text-base lg:col-start-auto">
        <span className="block truncate">
          {row.record.reactions[0]?.verbatimTerm ?? "No reaction recorded"}
        </span>
        {/*
          Promoted from the quietest text in the row to a hairline marker in
          the reaction cell. CLAUDE.md says a disagreement IS the case; it used
          to render smaller than the reference number.
        */}
        <span className="flex flex-wrap gap-x-2 text-micro">
          {row.disagrees && (
            <span className="border-l-2 border-ink pl-1 text-ink">
              Sources disagree
            </span>
          )}
          {row.missing.length > 0 && (
            <span className="border-l-2 border-slate pl-1 text-slate">
              Incomplete — missing {row.missing.join(", ").replace(/_/g, " ")}
            </span>
          )}
        </span>
      </span>

      <span className="hidden truncate text-meta text-slate lg:block">
        {row.record.drugs[0]?.reportedName ?? "—"}
      </span>

      <span className="hidden text-meta tabular-nums text-slate lg:block">
        {row.seriousCount > 0 ? `${row.seriousCount} of 6` : "—"}
      </span>

      <span className="hidden text-meta text-slate lg:block">
        {row.listedness ?? (row.assessed ? "not ruled" : "—")}
      </span>

      <span className="hidden text-meta text-slate lg:block">
        {row.record.status.replace("_", " ")}
      </span>

      {/* Age, so staleness needs no arithmetic against the received date. */}
      <span
        className="hidden text-meta tabular-nums text-slate lg:block"
        title={`Received ${row.record.receivedAt}`}
      >
        {row.ageDays}d
      </span>

      <span className="hidden truncate text-meta text-slate lg:block">
        {row.claim?.displayName ?? "unclaimed"}
      </span>
    </Link>
  );
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="mb-3 border border-rule px-3 py-2 rounded-soft"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-micro uppercase tracking-label text-slate">
          Keyboard
        </p>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-micro uppercase tracking-label text-slate hover:text-steady"
        >
          Close ✕
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {[
          ["j / ↓", "Next case"],
          ["k / ↑", "Previous case"],
          ["Enter", "Open the highlighted case"],
          ["/", "Search the queue"],
          ["Esc", "Clear the search"],
          ["g then c", "Jump to a case by reference"],
          ["?", "Show or hide this"],
        ].map(([keys, what]) => (
          <div key={keys} className="flex items-baseline gap-2">
            <dt className="font-mono text-micro text-ink">{keys}</dt>
            <dd className="text-micro text-slate">{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

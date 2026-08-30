"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget, queueShortcut } from "@/lib/queue/shortcuts";

/**
 * The queue search box.
 *
 * A GET form, so the server keeps doing the filtering and the result is a URL
 * a reviewer can bookmark or send to a colleague. The only thing this
 * component adds is the shortcut.
 *
 * `/` FOCUSES THIS, NOT THE RAIL'S JUMP BOX. Both want the same key, and on
 * this page the search is the closer answer — the jump box is for a reference
 * somebody read out over a call, and it keeps `g` then `c`. The rail's handler
 * stands down whenever an element marked `data-primary-search` is on the page,
 * so the arbitration lives in one place rather than in a guess on each side.
 */
export function QueueSearch({
  defaultValue,
  hidden,
}: {
  defaultValue: string;
  /** Filters and sort, carried through so searching does not drop them. */
  hidden: Readonly<Record<string, string>>;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
        hasRows: true,
      });

      // Esc clears and submits, but only from inside this box — the one case
      // where a key IS handled while focus is in a field, because it is this
      // field. Elsewhere it belongs to whatever has focus.
      if (action.kind === "dismiss" && document.activeElement === input.current) {
        event.preventDefault();
        if (input.current !== null && input.current.value.length > 0) {
          input.current.value = "";
          input.current.form?.requestSubmit();
        } else {
          input.current?.blur();
        }
        return;
      }

      if (action.kind === "focus_search") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form method="get" action="/queue" className="flex-1">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="queue-q" className="sr-only">
        Search the queue
      </label>
      <div className="flex gap-2">
        <input
          id="queue-q"
          ref={input}
          name="q"
          type="search"
          data-primary-search="queue"
          defaultValue={defaultValue}
          placeholder="Reference, reaction, drug or reporter"
          className="min-w-0 flex-1 rounded-soft border border-rule bg-surface px-2 py-1 text-meta focus:outline-2 focus:outline-offset-1 focus:outline-steady"
        />
        <button
          type="submit"
          className="cursor-pointer rounded-soft border border-rule px-3 py-1 text-meta hover:border-steady hover:text-steady"
        >
          Search
        </button>
      </div>
    </form>
  );
}

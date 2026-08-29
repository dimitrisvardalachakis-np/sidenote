"use client";

import { useEffect, useRef } from "react";

/**
 * The jump box. A colleague says a case number; this is where it goes.
 *
 * A plain GET form to `/goto`, so it works with JavaScript off. The only thing
 * this component adds is the shortcut: `/` focuses it, and so does `g` then
 * `c` for anyone whose fingers already know that idiom from other tools.
 *
 * The guard below is the part worth reading. A global keydown listener that
 * grabs `/` will eat the slash out of a reviewer typing a rationale, a search
 * query, or a dose. So the handler stands down whenever focus is already in a
 * field, or a modifier is held, or a `<dialog>` is open — which is every case
 * where the keystroke belongs to something else.
 *
 * It also stands down for `/` on a page that has its own primary search. Two
 * boxes competing for one key is worse than either having it, and on the queue
 * the search is the nearer answer — this box is for a reference somebody read
 * out over a call, and `g` then `c` still reaches it from anywhere.
 */
function typingInAField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function JumpToCase() {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // `g` is only a prefix if `c` follows it promptly; otherwise it was a
    // reviewer starting to type something else and we must not swallow it.
    let awaitingC = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function focusBox(event: KeyboardEvent) {
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInAField(event.target)) return;
      if (document.querySelector("dialog[open]") !== null) return;

      if (awaitingC && event.key === "c") {
        awaitingC = false;
        focusBox(event);
        return;
      }
      awaitingC = false;

      if (event.key === "/") {
        // A page with its own search owns the slash.
        if (document.querySelector("[data-primary-search]") !== null) return;
        focusBox(event);
        return;
      }
      if (event.key === "g") {
        awaitingC = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          awaitingC = false;
        }, 1200);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return (
    <form method="get" action="/goto" className="px-3 py-2">
      <label
        htmlFor="jump-ref"
        className="block text-micro uppercase tracking-label text-slate"
      >
        Go to case
      </label>
      <input
        id="jump-ref"
        ref={input}
        name="ref"
        type="search"
        autoComplete="off"
        placeholder="SN-2026-000104"
        aria-describedby="jump-hint"
        className="mt-1 w-full rounded-soft border border-rule bg-paper px-2 py-1 text-meta focus:outline-2 focus:outline-offset-1 focus:outline-steady"
      />
      <p id="jump-hint" className="mt-1 text-micro text-slate">
        Reference or number. Press <kbd className="font-mono">/</kbd> to focus.
      </p>
    </form>
  );
}

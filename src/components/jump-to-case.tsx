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
    <form method="get" action="/goto">
      <label htmlFor="jump-ref" className="sr-only">
        Go to case by reference
      </label>
      <div className="relative">
        <input
          id="jump-ref"
          ref={input}
          name="ref"
          type="search"
          autoComplete="off"
          placeholder="Jump to SN-…"
          aria-describedby="jump-hint"
          className="min-h-9 w-full rounded-soft border border-rule bg-surface py-1.5 pr-12 pl-3 text-meta placeholder:text-slate-quiet focus:outline-2 focus:outline-offset-1 focus:outline-steady"
        />
        {/*
          The binding that actually works, printed where the mockup drew ⌘K.
          ⌘K is not wired to anything here, and a key hint on a control is a
          promise about the keyboard — `g` then `c` reaches this box from
          anywhere, including the queue, where `/` belongs to the search.
        */}
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[4px] border border-rule px-1.5 py-0.5 font-mono text-micro text-slate-quiet"
        >
          g c
        </kbd>
      </div>
      <p id="jump-hint" className="sr-only">
        Type a reference or a case number. Press g then c to focus this box.
      </p>
    </form>
  );
}

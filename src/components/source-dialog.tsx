"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A cited passage, shown where it sits in its document.
 *
 * A citation on screen is a quotation and an id, and checking it has until now
 * meant trusting us. This opens the passage with its neighbours around it, the
 * verified span marked inside it, and — for a public FDA label — a link to the
 * genuine record on DailyMed.
 *
 * A native `<dialog>` with `showModal()`. Esc, the focus trap, the inert
 * background and the backdrop are all browser behaviour rather than three
 * hundred lines of a focus-management library, which is what keeps the "no new
 * dependency" rule from costing anything here.
 *
 * The CONTENT is server-rendered and handed in as children. Nothing is
 * fetched: the case screen already holds the corpus, so the surrounding
 * passages are computed there and passed down. That also means the dialog
 * cannot show something the server did not verify.
 */
export function SourceDialog({
  label,
  children,
}: {
  /** What the trigger says, e.g. "see in source". */
  label: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  /*
    Close on a click outside the panel. `<dialog>` gives no such event, but a
    click on the backdrop lands on the dialog element itself rather than on its
    contents — so a target of exactly the dialog is a backdrop click.
  */
  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    function onClick(event: MouseEvent) {
      if (event.target === node) node?.close();
    }
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="cursor-pointer text-micro text-steady hover:underline"
      >
        {label} ↗
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        /*
          `m-auto` centres it: a dialog's default placement is the top of the
          viewport. `max-h` with an inner scroll keeps a long passage inside
          the panel instead of growing it past the screen.
        */
        /*
          `normal-case tracking-normal` is not cosmetic. The trigger sits
          inside a citation metadata row styled `uppercase tracking-label`, and
          a <dialog> is a DOM child of wherever it is written — so the whole
          passage rendered in capitals with letter-spacing, which is unreadable
          for a paragraph and quietly misquotes a document whose text is mixed
          case. Reset here rather than at each call site, so the dialog is
          correct wherever it is placed.
        */
        className="m-auto max-h-[85vh] w-[min(72ch,92vw)] overflow-y-auto rounded-soft border border-rule bg-surface p-0 text-ink normal-case tracking-normal backdrop:bg-ink/40"
      >
        <div className="sticky top-0 flex items-baseline justify-between gap-3 border-b border-rule bg-surface px-4 py-2">
          <p id={titleId} className="min-w-0 text-micro uppercase tracking-label text-slate">
            Source passage
          </p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="shrink-0 cursor-pointer text-micro uppercase tracking-label text-slate hover:text-steady"
          >
            Close ✕
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </dialog>
    </>
  );
}

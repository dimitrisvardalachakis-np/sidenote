"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A native `<dialog>` opened by a button, with the mechanics in one place.
 *
 * Esc, the focus trap, the inert background and the backdrop are all browser
 * behaviour rather than three hundred lines of a focus-management library,
 * which is what keeps the "no new dependency" rule from costing anything.
 *
 * Extracted from SourceDialog when the library's uploader needed the same
 * thing. Two copies of a focus trap is one copy that falls behind.
 */
export function Modal({
  label,
  title,
  triggerClassName,
  width = "72ch",
  children,
}: {
  /** What the trigger says. */
  label: string;
  /** Names the dialog for a screen reader, and heads the panel. */
  title: string;
  triggerClassName: string;
  /** The panel's max width, as a CSS length. */
  width?: string;
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
        className={triggerClassName}
      >
        {label}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        /*
          `m-auto` centres it: a dialog's default placement is the top of the
          viewport. `max-h` with an inner scroll keeps long content inside the
          panel instead of growing it past the screen.

          `normal-case tracking-normal` is not cosmetic. A trigger often sits
          inside a metadata row styled `uppercase tracking-label`, and a
          <dialog> is a DOM child of wherever it is written — so the content
          rendered in capitals with letter-spacing, which is unreadable for a
          paragraph and quietly misquotes a document whose text is mixed case.
          Reset here rather than at each call site.

          The scrim lives in tokens.css as a plain `dialog::backdrop` rule —
          see there for why it cannot be a utility on this element.
        */
        style={{ width: `min(${width}, 92vw)` }}
        className="m-auto max-h-[85vh] overflow-y-auto rounded-card border border-rule bg-surface p-0 text-ink normal-case tracking-normal shadow-float"
      >
        <div className="sticky top-0 flex items-baseline justify-between gap-3 border-b border-rule bg-surface px-4 py-2.5">
          <p
            id={titleId}
            className="min-w-0 font-mono text-micro uppercase tracking-label text-slate"
          >
            {title}
          </p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="shrink-0 cursor-pointer font-mono text-micro uppercase tracking-label text-slate hover:text-steady"
          >
            Close ✕
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </dialog>
    </>
  );
}

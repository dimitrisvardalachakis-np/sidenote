/**
 * Which key does what on the queue, and when to stand down.
 *
 * Pure, and separate from the component, because the interesting behaviour
 * here is not "j moves down" — it is every case where a global key listener
 * must NOT act: while somebody is typing a rationale, while a dialog is open,
 * while a modifier is held. Those are the bugs a keyboard shortcut ships with,
 * and they are only testable if the decision is a function.
 *
 * The component reads a real KeyboardEvent into this shape and does what it
 * returns. Nothing here touches the DOM.
 */

export type QueueAction =
  | { readonly kind: "none" }
  | { readonly kind: "move"; readonly delta: number }
  | { readonly kind: "open" }
  | { readonly kind: "focus_search" }
  | { readonly kind: "toggle_help" }
  | { readonly kind: "dismiss" };

export interface KeyContext {
  readonly key: string;
  readonly withModifier: boolean;
  /** Focus is in an input, textarea, select or contenteditable. */
  readonly inField: boolean;
  /** A modal `<dialog>` is open somewhere on the page. */
  readonly dialogOpen: boolean;
  readonly hasRows: boolean;
}

export function queueShortcut(context: KeyContext): QueueAction {
  const { key, withModifier, inField, dialogOpen, hasRows } = context;

  /*
    A modifier means the keystroke belongs to the browser or the OS. Cmd-K is
    somebody's browser search, not our "previous row".
  */
  if (withModifier) return { kind: "none" };

  /*
    A dialog owns the keyboard while it is open — that is the whole point of a
    modal. Escape included: the dialog closes itself.
  */
  if (dialogOpen) return { kind: "none" };

  /*
    Escape is the one key handled while focus is in a field, because the field
    it is handled for is the search box. Everything else stands down: a
    reviewer typing "should this be 4.8/4.9" into a rationale must keep their
    slash.
  */
  if (key === "Escape") return { kind: "dismiss" };
  if (inField) return { kind: "none" };

  switch (key) {
    case "j":
    case "ArrowDown":
      return hasRows ? { kind: "move", delta: 1 } : { kind: "none" };
    case "k":
    case "ArrowUp":
      return hasRows ? { kind: "move", delta: -1 } : { kind: "none" };
    case "Enter":
      return hasRows ? { kind: "open" } : { kind: "none" };
    case "/":
      return { kind: "focus_search" };
    case "?":
      return { kind: "toggle_help" };
    default:
      return { kind: "none" };
  }
}

/** Whether an element is one a person types into. */
export function isTypingTarget(element: {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}): boolean {
  if (element.isContentEditable === true) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

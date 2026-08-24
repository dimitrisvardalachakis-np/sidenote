"use client";

/**
 * The in-progress report, held in sessionStorage.
 *
 * sessionStorage rather than localStorage on purpose: a half-written report
 * about someone's health should not still be sitting in the browser next week,
 * and on a shared or library computer that matters. Closing the tab clears it.
 *
 * useSyncExternalStore rather than useState plus an effect. The server cannot
 * see sessionStorage, so this is external state, and that hook is built for
 * exactly this: it renders the server snapshot during hydration and swaps to
 * the real value without a mismatch and without a cascading re-render.
 *
 * getSnapshot has to return a stable reference or React re-renders forever, so
 * the parsed value is cached against the raw string it came from.
 */
import { EMPTY_DRAFT, ReportDraft } from "@/lib/schemas/report";

const KEY = "sidenote-report-draft";
const CHANGED = "sidenote:report-draft-changed";

export interface SavedProgress {
  readonly draft: ReportDraft;
  /** Which step the reporter had reached, so a refresh returns them to it. */
  readonly stepIndex: number;
  /**
   * Set once the report has been sent.
   *
   * Kept here rather than in component state so that refreshing the
   * confirmation screen still shows the reference number. Losing someone's
   * reference because they pressed reload would be a poor way to end a form
   * that has just asked them about the worst week of their year.
   */
  readonly submitted: { readonly reference: string; readonly caseId: string } | null;
}

const BLANK: SavedProgress = {
  draft: EMPTY_DRAFT,
  stepIndex: 0,
  submitted: null,
};

let cachedRaw: string | null = null;
let cachedValue: SavedProgress = BLANK;

function read(): SavedProgress {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    // Private mode, or storage disabled. Working without saving is a fine
    // outcome; losing the form to an exception is not.
    return BLANK;
  }

  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;

  if (raw === null) {
    cachedValue = BLANK;
    return cachedValue;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const shape =
      typeof parsed === "object" && parsed !== null
        ? (parsed as {
            draft?: unknown;
            stepIndex?: unknown;
            submitted?: unknown;
          })
        : {};
    // Validated, not cast. A draft saved by an older version of this form is
    // discarded rather than rendered into a shape the UI no longer expects.
    const draft = ReportDraft.safeParse(shape.draft);
    const submitted = shape.submitted;
    const validSubmitted =
      typeof submitted === "object" &&
      submitted !== null &&
      typeof (submitted as { reference?: unknown }).reference === "string" &&
      typeof (submitted as { caseId?: unknown }).caseId === "string"
        ? (submitted as { reference: string; caseId: string })
        : null;

    cachedValue = draft.success
      ? {
          draft: draft.data,
          stepIndex:
            typeof shape.stepIndex === "number" && shape.stepIndex >= 0
              ? shape.stepIndex
              : 0,
          submitted: validSubmitted,
        }
      : BLANK;
  } catch {
    cachedValue = BLANK;
  }
  return cachedValue;
}

export function subscribeToDraft(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readDraft(): SavedProgress {
  return read();
}

/** The server has no sessionStorage and must not guess. */
export function readServerDraft(): SavedProgress {
  return BLANK;
}

export function writeDraft(next: SavedProgress): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not fatal: the form keeps working, it just will not survive a refresh.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
  window.dispatchEvent(new Event(CHANGED));
}

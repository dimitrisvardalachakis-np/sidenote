"use client";

/**
 * The in-progress report, held in localStorage with a 24-hour expiry.
 *
 * It was sessionStorage, on the reasoning that a half-written report about
 * someone's health should not still be sitting in the browser next week — and
 * on a shared or library computer that matters. The instinct was right and the
 * absence of a middle option was not: on a phone, a five-minute form and one
 * incoming call is a lost report.
 *
 * So: localStorage, expiring a day after it was last touched, said plainly to
 * the reporter on the page, with a control to clear it now. A day is long
 * enough to come back after a phone call or a night's sleep and short enough
 * that a library computer is not holding somebody's medical history a week
 * later.
 *
 * ONE STORE, BOTH INTAKES. The chat used to keep its state on the server round
 * trip and the form kept its own here, so crossing between them started from
 * nothing. `lib/report/draft.ts` maps between the two shapes; this is where
 * the result lives.
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
import { UNANSWERED } from "@/lib/schemas/answer";

const KEY = "sidenote-report-draft";
const CHANGED = "sidenote:report-draft-changed";

/** How long a draft outlives the last edit. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_TTL_LABEL = "a day";

export interface SavedProgress {
  readonly draft: ReportDraft;
  /** Which step the reporter had reached, so a refresh returns them to it. */
  readonly stepIndex: number;
  /**
   * When this was last written, so it can expire.
   *
   * Stored rather than inferred, and checked on READ: a draft that has sat
   * untouched for a day is discarded when somebody comes back to it, without
   * needing a timer to have run in a tab nobody had open.
   */
  readonly savedAt: number;
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
  savedAt: 0,
  submitted: null,
};

let cachedRaw: string | null = null;
let cachedValue: SavedProgress = BLANK;

/**
 * Recover a saved draft field by field, rather than all or nothing.
 *
 * It WAS all or nothing: one `ReportDraft.safeParse`, and anything that failed
 * became a blank form at step one. That turned a single unparseable answer
 * into the loss of every answer — and because the schema used to refuse a
 * half-typed email address, "a single unparseable answer" happened on the
 * second keystroke of the email box, mid-form, with a name already filled in.
 *
 * The schema no longer refuses what someone is still typing, so this should
 * never fire now. It stays because the failure it produced was so much worse
 * than its cause: whatever a future field rejects, the reporter should lose
 * that answer and no other.
 */
function salvage(raw: unknown): ReportDraft | null {
  const whole = ReportDraft.safeParse(raw);
  if (whole.success) return whole.data;

  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : null;
  // Not an object at all: there is nothing here to keep.
  if (source === null) return null;

  const kept: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(ReportDraft.shape)) {
    const parsed = schema.safeParse(source[field]);
    kept[field] = parsed.success ? parsed.data : UNANSWERED;
  }
  const recovered = ReportDraft.safeParse(kept);
  return recovered.success ? recovered.data : null;
}

function read(): SavedProgress {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
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
            savedAt?: unknown;
            submitted?: unknown;
          })
        : {};
    // Validated, not cast, but field by field: a value the UI no longer
    // expects is dropped on its own rather than taking the form with it.
    const draft = salvage(shape.draft);
    const submitted = shape.submitted;
    const validSubmitted =
      typeof submitted === "object" &&
      submitted !== null &&
      typeof (submitted as { reference?: unknown }).reference === "string" &&
      typeof (submitted as { caseId?: unknown }).caseId === "string"
        ? (submitted as { reference: string; caseId: string })
        : null;

    /*
      Expiry is enforced here, on read, rather than by a timer. A tab nobody
      had open cannot run one, and the case that matters is exactly the person
      coming back tomorrow.

      A SENT report is exempt: the confirmation holds the reference number, and
      taking that away while somebody is still looking at it would be a poor
      way to end a form that just asked about the worst week of their year.
    */
    const savedAt =
      typeof shape.savedAt === "number" && Number.isFinite(shape.savedAt)
        ? shape.savedAt
        : 0;
    const expired =
      validSubmitted === null && Date.now() - savedAt > DRAFT_TTL_MS;

    cachedValue =
      draft !== null && !expired
        ? {
            draft,
            stepIndex:
              typeof shape.stepIndex === "number" && shape.stepIndex >= 0
                ? shape.stepIndex
                : 0,
            savedAt,
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

/** The server has no localStorage and must not guess. */
export function readServerDraft(): SavedProgress {
  return BLANK;
}

export function writeDraft(next: SavedProgress): void {
  try {
    // Stamped on every write, so the day runs from the last edit rather than
    // from whenever the form was first opened.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...next, savedAt: Date.now() }),
    );
  } catch {
    // Not fatal: the form keeps working, it just will not survive a refresh.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
  window.dispatchEvent(new Event(CHANGED));
}

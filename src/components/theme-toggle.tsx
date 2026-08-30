"use client";

import { useRef, useSyncExternalStore } from "react";
import {
  THEME_LABELS,
  THEME_MODES,
  applyThemeMode,
  readStoredThemeMode,
  storeThemeMode,
  subscribeToThemeMode,
  type ThemeMode,
} from "@/lib/theme";

/**
 * The theme control, behind a disclosure in the rail footer.
 *
 * It was three always-visible buttons in the navigation of a tool whose actual
 * job is triaging safety cases — the loudest control in the rail, for the
 * setting a reviewer touches once. Prominence now matches frequency: one word
 * in the footer, and the three choices only when asked for.
 *
 * A `<details>` rather than a hand-rolled popover, because the browser already
 * knows how to open and close one, expose it to a screen reader, and let a
 * keyboard reach it. The only thing added is closing it after a choice — a
 * menu that stays open over the thing it just changed is a menu still asking
 * a question that has been answered.
 *
 * useSyncExternalStore rather than useState + useEffect. localStorage is
 * external state the server cannot see, and this hook is built for exactly
 * that: it renders `getServerSnapshot` during SSR and hydration, then swaps to
 * the real value without a mismatch. It also means a theme change in another
 * tab updates this control, which the effect version could not do at all.
 *
 * The visible colours are already correct before any of this runs — the inline
 * script in <head> set data-theme before first paint. This only decides which
 * option is marked current.
 */
export function ThemeMenu() {
  const mode = useSyncExternalStore(
    subscribeToThemeMode,
    readStoredThemeMode,
    // The server has no localStorage and must not guess: "system" is the
    // honest default and matches what an unconfigured browser does.
    () => "system" as ThemeMode,
  );
  const details = useRef<HTMLDetailsElement>(null);

  function choose(next: ThemeMode) {
    applyThemeMode(next);
    storeThemeMode(next); // dispatches the change event this component reads
    if (details.current !== null) details.current.open = false;
  }

  return (
    <details ref={details} className="relative">
      <summary
        className="flex min-h-8 cursor-pointer list-none items-center rounded-soft px-2 py-1 font-mono text-micro uppercase tracking-label text-slate hover:bg-surface-sunken hover:text-ink [&::-webkit-details-marker]:hidden"
        aria-label="Colour theme"
      >
        Theme
      </summary>
      {/*
        Opens UPWARD. This sits at the bottom of a full-height rail, so a menu
        that opened downward would open off the screen.
      */}
      <div className="absolute right-0 bottom-full z-20 mb-2 w-36 rounded-card border border-rule bg-surface p-1 shadow-float">
        <ul>
          {THEME_MODES.map((option) => {
            const current = mode === option;
            return (
              <li key={option}>
                <button
                  type="button"
                  aria-pressed={current}
                  onClick={() => choose(option)}
                  className={[
                    "flex min-h-8 w-full cursor-pointer items-center rounded-soft px-2 py-1 text-left text-base",
                    current
                      ? "bg-steady-wash text-steady"
                      : "text-slate hover:bg-surface-sunken hover:text-ink",
                  ].join(" ")}
                >
                  {THEME_LABELS[option]}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

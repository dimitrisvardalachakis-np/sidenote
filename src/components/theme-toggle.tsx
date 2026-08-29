"use client";

import { useSyncExternalStore } from "react";
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
 * A three-way segmented control, sized to sit in a footer without asking for
 * attention.
 *
 * It used to be the loudest control in the navigation: three always-visible
 * buttons above everything else in the rail, in a tool whose actual job is
 * triaging safety cases. Prominence is now inverted to match how often it is
 * used — it lives in the rail footer beside the reviewer's identity, labelled
 * once, at `--micro`.
 *
 * The buttons were also 22px tall, under any usable touch target. They are
 * 24px minimum now, which is the smallest this design language can justify
 * and still be pressable; the width came from the labels, so shortening them
 * to one word each is what paid for the height.
 *
 * useSyncExternalStore rather than useState + useEffect. localStorage is
 * external state that the server cannot see, and this hook is built for
 * precisely that: it renders `getServerSnapshot` during SSR and hydration,
 * then swaps to the real value without a mismatch and without the cascading
 * re-render that setState-inside-an-effect causes. It also means a theme
 * change in another tab updates this control, which the effect version could
 * not do at all.
 *
 * The visible colours are already correct before any of this runs — the
 * inline script in <head> set data-theme before first paint. This hook only
 * decides which segment is marked current.
 */
export function ThemeToggle() {
  const mode = useSyncExternalStore(
    subscribeToThemeMode,
    readStoredThemeMode,
    // The server has no localStorage and must not guess: "system" is the
    // honest default and matches what an unconfigured browser does.
    () => "system" as ThemeMode,
  );

  function choose(next: ThemeMode) {
    applyThemeMode(next);
    storeThemeMode(next); // dispatches the change event this component reads
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex w-full items-stretch rounded-soft border border-rule"
    >
      {THEME_MODES.map((option) => {
        const current = mode === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={current}
            onClick={() => choose(option)}
            className={[
              // min-h-6 is 24px on the 4px scale: the floor for a target
              // somebody has to hit, and the reason the labels are one word.
              "min-h-6 flex-1 px-2 py-1 text-micro uppercase tracking-label",
              "border-r border-rule last:border-r-0",
              "first:rounded-l-soft last:rounded-r-soft",
              "cursor-pointer transition-colors",
              current
                ? "bg-steady-wash text-steady"
                : "text-slate hover:bg-row-hover hover:text-ink",
            ].join(" ")}
          >
            {THEME_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

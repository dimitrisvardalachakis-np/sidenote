/**
 * Theme selection.
 *
 * Three modes, not two. "System" is the default and has to remain reachable:
 * a reviewer whose machine flips to dark at sunset should be able to follow
 * that, and a two-state toggle silently strands them on whichever they picked
 * last. Absence of the `data-theme` attribute *is* system mode, which keeps
 * the CSS media query in charge rather than having JavaScript recompute it.
 */

export const THEME_STORAGE_KEY = "sidenote-theme";

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_LABELS: Readonly<Record<ThemeMode, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function isThemeMode(value: unknown): value is ThemeMode {
  return (
    value === "system" || value === "light" || value === "dark"
  );
}

/**
 * Applies a mode by setting or clearing the attribute the CSS keys off.
 * Removing it rather than writing "system" matters: `:root:not([data-theme])`
 * is how the prefers-color-scheme block regains control.
 */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    // Private browsing, or storage disabled. Falling back to system is the
    // correct failure: the reviewer still gets a usable theme.
    return "system";
  }
}

/**
 * Fired when this tab changes the theme.
 *
 * The native `storage` event only fires in *other* tabs, so a component
 * subscribed to storage alone would never see its own click. This custom
 * event closes that gap, and the two together mean a theme change in one tab
 * updates every open tab's control.
 */
export const THEME_CHANGE_EVENT = "sidenote:themechange";

export function storeThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // Non-fatal: the choice simply will not survive a reload.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Subscribe to theme changes from this tab or any other. Returns the
 * unsubscribe function useSyncExternalStore expects.
 */
export function subscribeToThemeMode(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

/**
 * Runs synchronously in <head>, before the browser paints anything.
 *
 * Without this the page renders in the server's guess — light — and then
 * snaps to dark once React hydrates. That white flash is genuinely unpleasant
 * at night and is the entire reason this is an inline blocking script rather
 * than an effect. It is wrapped in try/catch because localStorage throws
 * outright in some privacy modes, and a theme preference is not worth a blank
 * page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(m==="light"||m==="dark"){document.documentElement.setAttribute("data-theme",m)}}catch(e){}})();`;

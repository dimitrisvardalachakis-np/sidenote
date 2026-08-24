import { ThemeToggle } from "./theme-toggle";

/**
 * CLAUDE.md non-negotiable #7: a visible banner on every page.
 *
 * It lives in the root layout rather than being pasted into each screen,
 * because "every page" should not depend on anyone remembering. A future
 * route gets it by existing.
 *
 * Deliberately not --signal. The red means expedited or overdue and nothing
 * else, ever; spending it on a standing notice would train the reviewer to
 * ignore exactly the colour that must never be ignored. This is a quiet,
 * permanent strip — it states a fact, it does not raise an alarm.
 */
export function DemoBanner() {
  return (
    <div className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2">
        <p className="text-micro uppercase tracking-label text-slate">
          Training demo · synthetic and public data · not a validated system
        </p>
        <ThemeToggle />
      </div>
    </div>
  );
}

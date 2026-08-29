/**
 * Non-negotiable #10: a visible banner on every page.
 *
 * It is a `<header>` with a label rather than a bare `<div>`, so a screen
 * reader can find it as a landmark instead of meeting it as an unattributed
 * sentence at the top of the page. It was previously the quietest text in the
 * interface, which is an odd way to treat the one line that says the numbers
 * on screen are not real: the first clause is now `--ink`, and only the
 * qualification behind it stays `--slate`.
 *
 * Emphasis by weight and colour, not by a box or a rule — this is a standing
 * statement of fact, not an alert, and it has to survive being on every screen
 * eight hours a day without becoming something the eye deletes.
 */
export function DemoBanner() {
  return (
    <header
      aria-label="Environment notice"
      className="border-b border-rule bg-paper"
    >
      <p className="px-4 py-2 text-micro uppercase tracking-label">
        <span className="font-medium text-ink">Training demo</span>
        <span className="text-slate">
          {" · "}synthetic and public data · not a validated system
        </span>
      </p>
    </header>
  );
}

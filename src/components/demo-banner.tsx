/**
 * Non-negotiable #10: a visible notice on every page.
 *
 * It used to be a full-width band under the header on both chromes. That band
 * is gone from the top of the page and the claim is not: the public header
 * carries a "Training demo" pill, and this is the rest of the sentence — the
 * part that says what a training demo means — in the public footer and in the
 * reviewer rail's footer.
 *
 * One component and one string, imported by both, because the alternative is
 * the same sentence typed in two files and drifting. It is the quietest text
 * in the interface by design and, being on every screen eight hours a day,
 * that is the only weight it can carry without becoming something the eye
 * deletes. The louder half of the claim is the pill, where it is first read.
 */
export const DEMO_NOTICE =
  "Training demo · synthetic and public data · not a validated system";

export function DemoNotice({ className }: { className?: string }) {
  return (
    <p
      className={[
        "font-mono text-micro uppercase tracking-label text-slate-quiet",
        className ?? "",
      ].join(" ")}
    >
      {DEMO_NOTICE}
    </p>
  );
}

import Link from "next/link";

/**
 * The whole navigation a reporter needs.
 *
 * A patient filling in this form used to be looking at `Reviewer · Queue ·
 * Library` in a 236px rail that did not shrink. There is no rail here. There
 * is a wordmark, the environment notice, one way to look a medicine up, and
 * one quiet way across to the reviewer side.
 *
 * The notice is a pill beside the wordmark rather than the full-width band it
 * was. Non-negotiable #10 asks for a visible banner on every page, and the
 * pill alone would drop "synthetic and public data · not a validated system" —
 * so the full sentence stays, in the public layout's footer. Notice at the
 * top, qualification at the bottom, both visible, neither shouting at somebody
 * who is worried about a person they care for.
 *
 * `Reviewer sign-in` is a Link now. It was a form posting straight to `signIn`
 * because there was no screen to send anyone to, and a link to /queue would
 * have bounced off the auth gate back to here. /signin exists, is public, and
 * has a field to type a credential into.
 */
export function PublicHeader() {
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="group flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-[22px] shrink-0 rounded-[7px] bg-steady"
          />
          <span className="text-base font-semibold group-hover:text-steady">
            SideNote
          </span>
          <span className="rounded-pill bg-surface-sunken px-2 py-0.5 font-mono text-micro uppercase tracking-label text-slate">
            Training demo
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/report/search"
            className="text-meta text-slate hover:text-steady hover:underline"
          >
            Look up a medicine
          </Link>
          <Link
            href="/signin"
            className="flex min-h-9 items-center rounded-soft border border-rule px-3 py-1.5 text-meta text-ink hover:border-steady-line hover:text-steady"
          >
            Reviewer sign-in
          </Link>
        </div>
      </div>
    </header>
  );
}

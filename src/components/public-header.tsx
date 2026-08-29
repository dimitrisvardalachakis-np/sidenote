import Link from "next/link";
import { signIn } from "@/app/session-actions";
import { DemoBanner } from "./demo-banner";

/**
 * The whole navigation a reporter needs.
 *
 * A patient filling in this form used to be looking at `Reviewer · Queue ·
 * Library` in a 236px rail that did not shrink, which both undercut the "no
 * account needed, this is your form" framing and left about 130px of content
 * on a phone. There is no rail here. There is a wordmark, one quiet way across
 * to the reviewer side, and the banner.
 *
 * The sign-in control stays `--slate` and stays small on purpose. Keeping both
 * areas reachable from either chrome is a deliberate decision inherited from
 * the old sidebar and it is right; making the other area compete with the
 * question in front of you is not.
 *
 * It is a form rather than a link to /queue. A link would bounce off the auth
 * gate straight back to here for anyone who had signed out — a control that
 * appears to do nothing, which is worse than not offering it.
 */
export function PublicHeader() {
  return (
    <>
      <div className="border-b border-rule">
        <div className="mx-auto flex w-full max-w-[70ch] items-baseline justify-between gap-4 px-4 py-3">
          <Link href="/" className="group">
            <span className="text-base font-medium group-hover:text-steady">
              SideNote
            </span>
            <span className="ml-2 text-micro uppercase tracking-label text-slate">
              Drug safety triage
            </span>
          </Link>
          <form action={signIn}>
            <button
              type="submit"
              className="shrink-0 cursor-pointer text-meta text-slate hover:text-steady hover:underline"
            >
              Reviewer sign-in →
            </button>
          </form>
        </div>
      </div>
      <DemoBanner />
    </>
  );
}

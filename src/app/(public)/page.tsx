import Link from "next/link";
import { signIn } from "@/app/session-actions";

/**
 * The front door: one door per job.
 *
 * It used to offer two cards while the rail beside it offered three reporter
 * options, so the page picked for you and the menu immediately undermined the
 * choice. The first thing this app asked a frightened person to do was choose
 * a user interface.
 *
 * There is one report door now. Chat versus form is a decision made *inside*
 * the flow, where it can be reversed without losing anything. The lookup is
 * kept below and visibly smaller, because it is a different job — it is not a
 * third way to report, and presenting it as a peer is what made a worried
 * person weigh three options before they could say anything at all.
 *
 * Written as documentation, not marketing: no hero, no gradient, no
 * illustration.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-[70ch] px-4 py-10">
      <h1 className="text-title font-medium">SideNote</h1>
      <p className="mt-1 text-meta uppercase tracking-label text-slate">
        Drug safety case triage
      </p>

      <hr className="my-6" />

      <p className="text-prose">
        When someone reports a side effect from a medicine, a safety reviewer
        has to answer one question quickly: is this reaction already known for
        this drug, or is it new? If it is new and serious, the regulator must be
        notified within 15 days.
      </p>
      <p className="mt-4 text-prose">
        SideNote does the reading. It finds the relevant passage in the
        company&rsquo;s own safety documents and in the public FDA label, shows
        both side by side with citations, and the reviewer decides.
      </p>

      <hr className="my-8" />

      <h2 className="text-micro uppercase tracking-label text-slate">
        Which are you?
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Choice
          href="/report"
          title="I want to report a side effect"
          body="For patients, carers and clinicians. No account needed. Tell us what happened in your own words and we will ask for the rest."
          action="Start a report"
        />
        {/*
          A form rather than a Link: signing in is a state change, and there is
          no password to type. It sets the shared reviewer role and goes to the
          queue, which is honest about what this build does.
        */}
        <form action={signIn} className="contents">
          <button
            type="submit"
            className="group block cursor-pointer rounded-soft border border-rule p-4 text-left hover:bg-row-hover"
          >
            <span className="block text-base font-medium group-hover:text-steady">
              I am a safety reviewer
            </span>
            <span className="mt-1 block text-meta text-slate">
              Triage incoming cases against the company safety documents and the
              public label, with the 15-day clock enforced. One shared role, no
              password — this is a demo.
            </span>
            <span className="mt-3 block text-meta text-steady">
              Open the queue →
            </span>
          </button>
        </form>
      </div>

      {/*
        Below the two doors and visibly quieter. A lookup is not a report, and
        the copy says so before the link does.
      */}
      <div className="mt-8 border-t border-rule pt-4">
        <Link href="/report/search" className="group block">
          <span className="text-base group-hover:text-steady">
            I just want to know if something is normal
          </span>
          <span className="ml-2 text-meta text-steady">Look it up →</span>
        </Link>
        <p className="mt-1 text-meta text-slate">
          Searches the published information for a medicine. It does not report
          anything, and finding it there does not mean it does not matter.
        </p>
      </div>
    </main>
  );
}

function Choice({
  href,
  title,
  body,
  action,
}: {
  href: string;
  title: string;
  body: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="group block border border-rule p-4 rounded-soft hover:bg-row-hover"
    >
      <h3 className="text-base font-medium group-hover:text-steady">{title}</h3>
      <p className="mt-1 text-meta text-slate">{body}</p>
      <p className="mt-3 text-meta text-steady">{action} →</p>
    </Link>
  );
}

import Link from "next/link";

/**
 * The front door: choose an area.
 *
 * Written as documentation, not marketing — no hero, no gradient, no
 * illustration. The two cards are the two jobs this tool does, and the copy
 * says plainly which one applies to you, because a patient landing here after
 * a bad reaction should not have to work out whether they are a "reviewer".
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
          href="/report/chat"
          title="I want to report a side effect"
          body="For patients, carers and clinicians. No account needed. Describe what happened in your own words and we will ask for the rest."
          action="Start a report"
        />
        <Choice
          href="/queue"
          title="I am a safety reviewer"
          body="Triage incoming cases against the company safety documents and the public label, with the 15-day clock enforced."
          action="Open the queue"
        />
      </div>

      <p className="mt-6 text-meta text-slate">
        Both areas stay in the menu on the left, so you can move between them at
        any time.
      </p>
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

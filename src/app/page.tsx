import Link from "next/link";

/**
 * The landing page, written as documentation rather than marketing.
 *
 * CLAUDE.md rules out hero sections, gradients and marketing copy, which
 * leaves the honest version: say what the tool does, name the two ways in,
 * and get out of the way. The one concession to it being a front door is a
 * slightly wider measure than the app screens use, because this is the only
 * page anyone reads in paragraphs.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-[68ch] px-4 py-10">
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
        Today that means a human opening PDFs and reading. SideNote does the
        reading. It finds the relevant passage in the company&rsquo;s own safety
        documents and in the public FDA label, shows both side by side with
        citations, and the reviewer decides.
      </p>

      <h2 className="mt-8 text-base font-medium">What the model does and does not do</h2>
      <p className="mt-2 text-prose">
        It extracts, retrieves, drafts and cites. It does not decide. Every
        claim on screen carries a chunk id and the quoted span it came from; a
        claim without one is not rendered at all. The reviewer accepts or
        rejects, and every decision is logged.
      </p>

      <h2 className="mt-8 text-base font-medium">Two sources, which may disagree</h2>
      <p className="mt-2 text-prose">
        <span className="font-medium">Listedness</span> asks whether the
        reaction appears in the company&rsquo;s core safety document.{" "}
        <span className="font-medium">Expectedness</span> asks whether it
        appears in the public FDA label. The company document is usually
        updated first, so the two can disagree. When they do, that is the
        headline of the case, not an error.
      </p>

      <hr className="my-8" />

      <nav aria-label="Entry points" className="flex flex-col gap-3">
        <Link
          href="/report"
          className="group border border-rule p-3 hover:bg-row-hover rounded-soft"
        >
          <span className="text-base font-medium group-hover:text-steady">
            Report a side effect
          </span>
          <span className="mt-1 block text-meta text-slate">
            For patients and carers. No account needed.
          </span>
        </Link>
        <Link
          href="/queue"
          className="group border border-rule p-3 hover:bg-row-hover rounded-soft"
        >
          <span className="text-base font-medium group-hover:text-steady">
            Reviewer queue
          </span>
          <span className="mt-1 block text-meta text-slate">
            Triage incoming cases against the safety documents.
          </span>
        </Link>
      </nav>
    </main>
  );
}

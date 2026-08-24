import Link from "next/link";

/**
 * The two-pane review screen.
 *
 * Left is the case, right is the evidence: two stacked panels, company
 * documents above the public FDA label. Step 8 builds both, including the
 * three states each panel must handle — grounded, no result found, and source
 * unavailable.
 *
 * The two-column frame is established now rather than later because it is the
 * constraint everything else is designed inside. The divider is a single
 * hairline, per the design direction: no fills, no cards, no shadows.
 */
export default async function CasePage({ params }: PageProps<"/case/[id]">) {
  const { id } = await params;

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-title font-medium">Case</h1>
        <Link href="/queue" className="text-meta text-steady hover:underline">
          Back to queue
        </Link>
      </div>
      <p className="mt-1 font-mono text-meta text-slate">{id}</p>

      <hr className="my-4" />

      <div className="grid flex-1 gap-0 md:grid-cols-2">
        <section
          aria-label="Case"
          className="border-rule pb-4 md:border-r md:pr-4 md:pb-0"
        >
          <h2 className="text-micro uppercase tracking-label text-slate">
            Case
          </h2>
          <p className="mt-2 text-base">
            Narrative, reactions, drugs, seriousness flags and the validity
            checklist. Step 8.
          </p>
        </section>

        <section aria-label="Evidence" className="pt-4 md:pt-0 md:pl-4">
          <h2 className="text-micro uppercase tracking-label text-slate">
            Evidence
          </h2>
          <div className="mt-2 border-b border-rule pb-4">
            <h3 className="text-base font-medium">Company documents</h3>
            <p className="mt-1 text-meta text-slate">
              CCDS or Investigator&rsquo;s Brochure. Confidential.
            </p>
          </div>
          <div className="pt-4">
            <h3 className="text-base font-medium">FDA label</h3>
            <p className="mt-1 text-meta text-slate">Public.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

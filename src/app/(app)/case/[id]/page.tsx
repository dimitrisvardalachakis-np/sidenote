import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseDetail } from "@/components/case-detail";
import { CaseList, clockLabel } from "@/components/case-list";
import { CompanyEvidence, PublicEvidence } from "@/components/evidence";
import { buildSeedCases, findSeedCase } from "@/lib/fixtures/seed";
import {
  expeditedClock,
  sourcesDisagree,
  standingExpectedness,
  standingListedness,
  type IsoDate,
} from "@/lib/schemas";

/**
 * The two-pane review screen.
 *
 * Left: the queue, so a reviewer moves between cases without going back and
 * losing their place. Right: this case, then the two evidence panels stacked —
 * company document above, public label below.
 *
 * The stacking order is not arbitrary. The company document is usually updated
 * first, so it is the one more likely to carry the newer answer, and it is the
 * one the 15-day clock actually keys off. Reading order follows importance.
 */
export default async function CasePage({ params }: PageProps<"/case/[id]">) {
  const { id } = await params;
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const seeded = findSeedCase(today, id);
  if (seeded === null) notFound();

  const { record, assessment } = seeded;
  const listed = standingListedness(assessment);
  const expected = standingExpectedness(assessment);
  const clock = expeditedClock(record, listed === "unlisted", today);
  const label = clockLabel(clock);
  const disagrees = sourcesDisagree(assessment);
  const all = buildSeedCases(today);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-4">
      <div className="grid flex-1 gap-0 lg:grid-cols-[320px_1fr]">
        {/* ---------------- left: the queue ---------------- */}
        <aside
          aria-label="Queue"
          className="border-rule pb-4 lg:border-r lg:pr-4 lg:pb-0"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-micro uppercase tracking-label text-slate">
              Queue
            </h2>
            <Link href="/queue" className="text-meta text-steady hover:underline">
              Full view
            </Link>
          </div>
          <div className="mt-1 max-h-[calc(100vh-12rem)] overflow-y-auto">
            <CaseList
              cases={all}
              today={today}
              compact
              currentId={record.id}
            />
          </div>
        </aside>

        {/* ---------------- right: the case ---------------- */}
        <div className="pt-4 lg:pt-0 lg:pl-4">
          <header className="border-b border-rule pb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-meta text-slate">
                  {record.reference}
                </p>
                <h1 className="mt-0.5 text-title font-medium">
                  {record.reactions[0]?.verbatimTerm ?? "No reaction recorded"}
                </h1>
              </div>
              <div className="text-right">
                <p
                  className={[
                    "text-figure leading-none tabular-nums",
                    label.urgent ? "text-signal" : "text-slate",
                  ].join(" ")}
                >
                  {label.text}
                </p>
                {clock.state !== "not_applicable" && (
                  <p className="mt-1 text-micro uppercase tracking-label text-slate">
                    due {clock.dueOn}
                  </p>
                )}
              </div>
            </div>

            {/*
              The headline of the case. CLAUDE.md: when the two sources
              disagree "that is the headline of the case, not an error state".
              So it is stated first, in words, above the evidence — not left
              for the reviewer to infer by comparing two panels.
            */}
            {disagrees && (
              <div className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2">
                <p className="text-base font-medium">
                  The two sources disagree.
                </p>
                <p className="mt-0.5 text-meta text-slate">
                  The company document says <strong>{listed}</strong>; the FDA
                  label says <strong>{expected}</strong>. The company document
                  is usually updated first. Read both passages below before
                  ruling.
                </p>
              </div>
            )}

            {clock.state !== "not_applicable" && (
              <p className="mt-3 text-meta text-slate">
                Serious and unlisted, so the 15-day expedited clock is running
                from Day 0 ({record.receivedAt}).
              </p>
            )}
          </header>

          <div className="mt-4">
            <CaseDetail record={record} />
          </div>

          <section aria-label="Evidence" className="mt-6 border-t border-rule pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-micro uppercase tracking-label text-slate">
                Evidence
              </h2>
              <p className="text-meta text-slate">
                Model output. No claim is shown without the passage it came
                from.
              </p>
            </div>

            <div className="mt-3">
              <CompanyEvidence finding={assessment.listedness} />
            </div>
            <div className="mt-6 border-t border-rule pt-4">
              <PublicEvidence finding={assessment.expectedness} />
            </div>
          </section>

          <section
            aria-label="Ruling"
            className="mt-6 border-t border-rule pt-4 pb-8"
          >
            <h2 className="text-micro uppercase tracking-label text-slate">
              Reviewer ruling
            </h2>
            {assessment.ruling === null ? (
              <p className="mt-1 text-base">
                No ruling yet. The model has suggested a reading of each source;
                nothing above counts as a decision until a reviewer records one
                here.
              </p>
            ) : (
              <p className="mt-1 text-base">
                {assessment.ruling.listedness} / {assessment.ruling.expectedness}{" "}
                — {assessment.ruling.rationale}
              </p>
            )}
            <p className="mt-2 text-meta text-slate">
              Claiming and ruling arrive with the Durable Object in Cluster D,
              which is what makes one case belong to one reviewer.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

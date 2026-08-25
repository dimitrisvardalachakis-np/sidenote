import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseDetail } from "@/components/case-detail";
import { CaseList, clockLabel } from "@/components/case-list";
import { CompanyEvidence, PublicEvidence } from "@/components/evidence";
import { findQueueEntry, loadQueue } from "@/lib/queue/entries";
import { RulingPanel } from "@/components/ruling-panel";
import { getCaseCoordination } from "@/lib/coordinator";
import { requireSession } from "@/lib/auth";
import {
  expeditedClock,
  isSerious,
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
 * first, so it is more likely to carry the newer answer, and it is what the
 * 15-day clock keys off. Reading order follows importance.
 */
export default async function CasePage({ params }: PageProps<"/case/[id]">) {
  const { id } = await params;
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const entry = await findQueueEntry(today, id);
  if (entry === null) notFound();

  const { record, assessment } = entry;
  const listed = assessment === null ? null : standingListedness(assessment);
  const expected = assessment === null ? null : standingExpectedness(assessment);
  const clock =
    assessment === null
      ? null
      : expeditedClock(record, listed === "unlisted", today);
  const disagrees = assessment !== null && sourcesDisagree(assessment);
  const serious = record.reactions.some((r) => isSerious(r.seriousness));
  const all = await loadQueue(today);

  // Who holds this case, and what has been decided. Read from the coordinator
  // rather than from the Case row: `assignedTo` is a mirror, and a mirror is
  // the wrong thing to ask when the question is "may I write to this".
  const session = await requireSession();
  const coordination = await getCaseCoordination();
  const coordinated = await coordination.state(record.id);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-4">
      <div className="grid flex-1 gap-0 lg:grid-cols-[320px_1fr]">
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
            <CaseList cases={all} today={today} compact currentId={record.id} />
          </div>
        </aside>

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
                    clock !== null && clockLabel(clock).urgent
                      ? "text-signal"
                      : "text-slate",
                  ].join(" ")}
                >
                  {clock === null
                    ? serious
                      ? "assess now"
                      : "not assessed"
                    : clockLabel(clock).text}
                </p>
                {clock !== null && clock.state !== "not_applicable" && (
                  <p className="mt-1 text-micro uppercase tracking-label text-slate">
                    due {clock.dueOn}
                  </p>
                )}
              </div>
            </div>

            {disagrees && (
              <div className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2">
                <p className="text-base font-medium">The two sources disagree.</p>
                <p className="mt-0.5 text-meta text-slate">
                  The company document says <strong>{listed}</strong>; the FDA
                  label says <strong>{expected}</strong>. The company document
                  is usually updated first. Read both passages below before
                  ruling.
                </p>
              </div>
            )}

            {clock !== null && clock.state !== "not_applicable" && (
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

            {assessment === null ? (
              /*
                Not assessed is NOT the same as "no result found", and must not
                look like it. No retrieval has run against this case, so the
                panels have nothing honest to show. Rendering empty panels here
                would read as "the documents do not mention this" — a finding
                nobody has actually made.
              */
              <div className="mt-3 border border-dashed border-rule px-3 py-3 rounded-soft">
                <p className="text-base font-medium">Not assessed yet</p>
                <p className="mt-1 text-meta text-slate">
                  This case arrived through the public intake and nobody has run
                  it against the safety documents. That is different from
                  &ldquo;nothing found&rdquo; — no search has happened, so
                  neither listedness nor expectedness can be stated, and no
                  expedited clock can be computed.
                </p>
                {serious && (
                  <p className="mt-2 text-meta text-ink">
                    A seriousness criterion is flagged. If this turns out to be
                    unlisted, the 15-day clock has been running since{" "}
                    {record.receivedAt}.
                  </p>
                )}
                <p className="mt-2 text-meta text-slate">
                  Retrieval runs on a queue consumer in Cluster E. Until then a
                  reviewer assesses by hand.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-3">
                  <CompanyEvidence finding={assessment.listedness} />
                </div>
                <div className="mt-6 border-t border-rule pt-4">
                  <PublicEvidence finding={assessment.expectedness} />
                </div>
              </>
            )}
          </section>

          <section
            aria-label="Ruling"
            className="mt-6 border-t border-rule pt-4 pb-8"
          >
            <h2 className="text-micro uppercase tracking-label text-slate">
              Reviewer ruling
            </h2>
            <div className="mt-2">
              <RulingPanel
                caseId={record.id}
                reviewerId={session.reviewerId}
                claim={coordinated.claim}
                ruling={coordinated.ruling ?? assessment?.ruling ?? null}
                arbitrates={coordination.arbitrates}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

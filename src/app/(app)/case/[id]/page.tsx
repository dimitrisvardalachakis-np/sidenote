import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CaseFacts,
  ReporterPanel,
  ValidityChecklist,
  WhyThisIsSerious,
} from "@/components/case-detail";
import { CaseHistory } from "@/components/case-history";
import { CaseList, clockLabel } from "@/components/case-list";
import { ClaimPanel } from "@/components/claim-panel";
import {
  CompanyEvidence,
  EvidencePair,
  PublicEvidence,
} from "@/components/evidence";
import { RulingForm } from "@/components/ruling-form";
import { SourceDialog } from "@/components/source-dialog";
import { SourcePassage } from "@/components/source-passage";
import { findQueueEntry, loadQueue } from "@/lib/queue/entries";
import { resolveAiBinding } from "@/lib/assess/ai";
import { aiEnv } from "@/lib/assess/env";
import { passageContext } from "@/lib/library/context";
import { coverageFor, isUncovered } from "@/lib/library/coverage";
import { writeBlockedReason } from "@/lib/case/claim";
import type { IsoDateTime } from "@/lib/schemas";
import { getCaseCoordination } from "@/lib/coordinator";
import { readAuditTrail } from "@/lib/store/audit-store";
import { loadCorpus } from "@/lib/store/corpus";
import { requireSession } from "@/lib/auth";
import { claimCase, recordRuling, releaseCase, runAssessment } from "./actions";
import { AssessControl } from "@/components/assess-control";
import {
  EXPEDITED_WINDOW_DAYS,
  documentStance,
  expeditedClock,
  isSerious,
  readingsDiverge,
  ruledExpectedness,
  ruledListedness,
  sourcesDisagree,
  type IsoDate,
} from "@/lib/schemas";

/**
 * The review screen, in the reviewer's order.
 *
 * A reviewer opens a case to answer one question — is this reaction already
 * described? — and that answer used to be the last thing on a 1400px page,
 * below nine cells of administrative metadata, split into two stacked panels
 * under a heading called "Evidence". The order here is the loop instead:
 *
 *   who has this  ->  is it already described  ->  record the decision  ->  next
 *
 * Everything else — the facts, the reporter, the history — is supporting
 * material and sits in a context rail at xl or behind a disclosure below it.
 *
 * The company column is on the left because the company document is usually
 * updated first and the 15-day clock keys off it. Reading order follows
 * importance, as it did when the panels were stacked.
 */
export async function generateMetadata({
  params,
}: PageProps<"/case/[id]">): Promise<Metadata> {
  const { id } = await params;
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const entry = await findQueueEntry(today, id);
  if (entry === null) return { title: "Case not found — SideNote" };

  const { record, assessment } = entry;
  const clock =
    assessment === null
      ? null
      : expeditedClock(
          record,
          ruledListedness(assessment) === "unlisted",
          today,
        );
  const state =
    clock === null || clock.state === "not_applicable"
      ? null
      : clockLabel(clock).text;

  return {
    title:
      state === null
        ? `${record.reference} — SideNote`
        : `${record.reference} · ${state} — SideNote`,
  };
}

export default async function CasePage({ params }: PageProps<"/case/[id]">) {
  const { id } = await params;
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const session = await requireSession();

  const entry = await findQueueEntry(today, id);
  if (entry === null) notFound();

  const { record, assessment } = entry;
  const listed = assessment === null ? null : ruledListedness(assessment);
  const expected = assessment === null ? null : ruledExpectedness(assessment);
  const clock =
    assessment === null
      ? null
      : expeditedClock(record, listed === "unlisted", today);
  const disagrees = assessment !== null && sourcesDisagree(assessment);
  // The pre-ruling headline: what the two documents were observed to say.
  // Only shown when one side actually has a citation, so an absence the model
  // reported without evidence cannot become the case's headline on its own.
  const diverges =
    assessment !== null &&
    !disagrees &&
    readingsDiverge(assessment) &&
    (documentStance(assessment.listedness) === "describes" ||
      documentStance(assessment.expectedness) === "describes");
  const companyDescribes =
    assessment !== null && documentStance(assessment.listedness) === "describes";
  const serious = record.reactions.some((r) => isSerious(r.seriousness));
  const codedAs = record.reactions[0]?.meddraPreferredTerm ?? null;
  const reporterName = record.reporter?.name ?? null;

  /*
    What the clock WOULD be if this case were ruled unlisted.

    Computed here, by the one real implementation, and handed to the form so it
    can show the consequence of a choice before the reviewer commits to it. The
    form chooses between two true statements rather than recomputing a
    regulatory deadline in the browser.
  */
  const clockIfUnlisted = expeditedClock(record, true, today);

  const all = await loadQueue(today);
  const position = all.findIndex((e) => e.record.id === record.id);
  const previous = position > 0 ? all[position - 1] : undefined;
  const next = position >= 0 ? all[position + 1] : undefined;

  /*
    The object, not the mirror.

    The queue reads the `claims` table because no per-case object can answer a
    question about all sixteen. Here there is exactly one case and the
    authority is reachable, and this value decides whether the ruling form is
    enabled — so it comes from the thing that would refuse the write, not from
    a best-effort copy of it.
  */
  const coordination = await getCaseCoordination();
  const claim = (await coordination.state(record.id)).claim;
  const blockedReason = writeBlockedReason(
    claim,
    session.reviewerId,
    new Date().toISOString() as IsoDateTime,
  );
  const history = await readAuditTrail(record.reference);

  // Whether a model is reachable at all, so the control can say what pressing
  // it will actually do rather than failing silently after the click.
  const ai = resolveAiBinding(await aiEnv());
  const assess = runAssessment.bind(null, record.id);
  const claimAction = claimCase.bind(null, record.id);
  const releaseAction = releaseCase.bind(null, record.id);
  const rulingAction = recordRuling.bind(null, record.id);

  /*
    The corpus, for the source dialogs.

    Loaded once here and the context computed on the server, so the dialog
    renders text this request actually verified rather than fetching it later
    from somewhere that might disagree.
  */
  const corpus = await loadCorpus();
  const labelSetId =
    assessment?.expectedness.state === "grounded"
      ? assessment.expectedness.labelSetId
      : null;

  /*
    Which documents were in scope for this search.

    Without it a case for a drug with NO company document looked exactly like a
    case for a drug with one, right up until the search returned nothing — and
    "no matching passage" then reads as a fact about the document rather than
    about the shelf. Same predicate retrieval uses, so the two cannot disagree.
  */
  const drug = record.drugs[0];

  /*
    What the generated answer is about, in the reviewer's own terms.

    Without it the paragraph reads as prose that happens to be on the page.
    With it, it reads as an answer to the question they opened the case to ask
    — "about liver failure, died in Hepalex" — which is what the reviewer said
    they wanted to see.
  */
  const aboutPhrase = [
    record.reactions[0]?.verbatimTerm,
    drug?.reportedName,
  ].every((part) => part !== undefined)
    ? `${record.reactions[0]?.verbatimTerm} in ${drug?.reportedName}`
    : (record.reactions[0]?.verbatimTerm ?? undefined);

  const coverage =
    drug === undefined
      ? null
      : coverageFor(corpus.documents, {
          reportedName: drug.reportedName,
          activeSubstance: drug.activeSubstance,
        });

  function seeSource(chunkId: string) {
    const context = passageContext(corpus.chunks, corpus.documents, chunkId);
    if (context === null) return null;
    const span =
      assessment?.listedness.state === "grounded" &&
      assessment.listedness.reading.status === "read" &&
      assessment.listedness.reading.chunkId === chunkId
        ? assessment.listedness.reading.quotedSpan
        : assessment?.expectedness.state === "grounded" &&
            assessment.expectedness.reading.status === "read" &&
            assessment.expectedness.reading.chunkId === chunkId
          ? assessment.expectedness.reading.quotedSpan
          : null;
    return (
      <SourceDialog label="see in source">
        <SourcePassage context={context} span={span} labelSetId={labelSetId} />
      </SourceDialog>
    );
  }

  /*
    One degraded notice for the pair, not one per panel.

    Both panels used to print the same three-line explanation and the same
    reason string. The explanation belongs to the situation, not to either
    column, so it is hoisted here and each panel keeps a one-line "not read".
  */
  const bothUnread =
    assessment !== null &&
    (assessment.listedness.state !== "grounded" ||
      assessment.listedness.reading.status === "unavailable") &&
    (assessment.expectedness.state !== "grounded" ||
      assessment.expectedness.reading.status === "unavailable");

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-4">
      <div className="grid flex-1 gap-0 lg:grid-cols-[292px_1fr]">
        {/*
          The queue rail is HIDDEN below lg rather than stacked. It used to sit
          above the case, so tapping a case on a phone landed you on the list
          you had just left with a thousand pixels to scroll. The prev/next
          strip in the header is what replaces it there.
        */}
        <aside
          aria-label="Queue"
          className="hidden rounded-card bg-surface-sunken p-3 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
        >
          <div className="flex items-baseline justify-between gap-2 px-1">
            <p className="font-mono text-micro uppercase tracking-label text-slate">
              Queue
            </p>
            <span className="font-mono text-meta text-slate">
              {all.length} cases
            </span>
          </div>
          <div className="mt-2">
            <CaseList cases={all} today={today} compact currentId={record.id} />
          </div>
        </aside>

        <div className="min-w-0 lg:pl-6">
          {/*
            Sticky, so the reference, the clock and the claim stay visible while
            a reviewer reads down the evidence. These are the three facts they
            need at every moment on this screen.
          */}
          <header className="sticky top-0 z-10 -mx-1 border-b border-rule bg-paper px-1 pt-2 pb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-micro uppercase tracking-label text-slate">
                  <li>
                    <Link href="/queue" className="hover:text-steady hover:underline">
                      Queue
                    </Link>
                  </li>
                  <li aria-hidden="true">›</li>
                  <li className="normal-case tracking-normal text-ink">
                    {record.reference}
                  </li>
                </ol>
              </nav>

              <CaseStepper
                position={position}
                total={all.length}
                previousId={previous?.record.id ?? null}
                nextId={next?.record.id ?? null}
              />
            </div>

            <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div className="min-w-0">
                <h1 className="text-[25px] leading-tight font-semibold">
                  {record.reactions[0]?.verbatimTerm ?? "No reaction recorded"}
                  <span className="ml-2.5 text-[16px] font-normal text-slate">
                    {record.drugs[0]?.reportedName ?? "no drug recorded"}
                  </span>
                </h1>
                {/*
                  The three facts a reviewer asks for immediately after the
                  reaction: what it was coded to, when the clock's Day 0 was,
                  and who reported it. All three were on the screen already —
                  Day 0 and the reporter behind a disclosure in the context
                  rail, the coded term in a facts grid — which meant the two
                  that decide the deadline were further from the deadline than
                  the administrative ones.
                */}
                <p className="mt-1.5 text-meta text-slate">
                  {codedAs !== null && (
                    <>
                      Coded as <span className="text-ink">{codedAs}</span>
                      {" · "}
                    </>
                  )}
                  Day 0{" "}
                  <span className="font-mono text-ink">{record.receivedAt}</span>
                  {reporterName !== null && (
                    <>
                      {" · "}reported by{" "}
                      <span className="text-ink">{reporterName}</span>
                    </>
                  )}
                </p>
              </div>

              {/*
                The clock, as a figure rather than a sentence. It is the one
                number on this screen that decides whether the case is late,
                and it was set at the same size as the drug name beside it.
              */}
              <div className="shrink-0 text-right">
                <p
                  className={[
                    "font-mono text-figure tabular-nums",
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
                  <p className="mt-1 font-mono text-micro uppercase tracking-label text-slate">
                    {EXPEDITED_WINDOW_DAYS}-day clock · due {clock.dueOn}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3">
              <ClaimPanel
                claim={claim}
                reviewerId={session.reviewerId}
                arbitrated={coordination.arbitrates}
                claimAction={claimAction}
                releaseAction={releaseAction}
              />
            </div>
          </header>

          {/*
            The context rail appears at 2xl, not xl, and the evidence pair
            splits at xl. They used to arrive together, so at 1280 the row was
            a 232px rail, two evidence columns and a 300px context rail — about
            290px per document, in which "Company Core Data Sheet ·
            confidential" wrapped over five lines and the quotations were four
            words wide. The side-by-side comparison is what the product is for;
            the facts beside it are reference material, so the facts wait.
          */}
          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              {/* ---- THE ANSWER, FIRST ---- */}
              <section aria-label="Evidence" className="mt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-h2 font-semibold">
                    Is it already described?
                  </h2>
                  {/*
                    Assess is demoted to what it is: a supporting step that
                    fetches passages, not the main event on this screen.

                    A client component now, so that finishing can be announced
                    as something that just happened rather than read off the
                    stored assessment on every render. See AssessControl.
                  */}
                  <AssessControl
                    caseId={record.id}
                    assessed={assessment !== null}
                    disabled={ai.binding === null}
                    title={ai.reason ?? "Search the safety documents and read the passages found"}
                    action={assess}
                  />
                </div>

                {assessment === null ? (
                  /*
                    Not assessed is NOT the same as "no result found", and must
                    not look like it. No retrieval has run against this case, so
                    the panels have nothing honest to show. Rendering empty
                    panels here would read as "the documents do not mention
                    this" — a finding nobody has actually made.
                  */
                  <div className="mt-3 rounded-card border border-dashed border-rule bg-surface px-4 py-4">
                    <p className="text-base font-medium">Not assessed yet</p>
                    <p className="mt-1 text-meta text-slate">
                      Nobody has run this case against the safety documents.
                      That is different from &ldquo;nothing found&rdquo; — no
                      search has happened, so neither listedness nor
                      expectedness can be stated, and no expedited clock can be
                      computed.
                    </p>
                    {serious && (
                      <p className="mt-2 text-meta text-ink">
                        A seriousness criterion is flagged. If this turns out to
                        be unlisted, the 15-day clock has been running since{" "}
                        {record.receivedAt}.
                      </p>
                    )}
                    {ai.binding === null && (
                      <p className="mt-2 text-meta text-slate">
                        No model is configured, so passages can be retrieved but
                        not read. {ai.reason} — see SETUP.md.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {bothUnread && (
                      <div className="mt-3 rounded-card border border-dashed border-rule bg-surface px-4 py-3">
                        <p className="text-base font-medium">
                          The passages were retrieved but not read
                        </p>
                        <p className="mt-1 text-meta text-slate">
                          This is not a finding that either document is silent —
                          nothing has read them. Both are shown below; read them
                          yourself.{" "}
                          {ai.binding === null && (
                            <>
                              {ai.reason} — see SETUP.md.
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    {/*
                      Side by side at xl, aligned row for row — stance, summary,
                      reading, passages. CLAUDE.md promises "both side by side
                      with citations"; stacking them meant the comparison the
                      product is built around had to be done from memory.
                    */}
                    <div className="mt-3">
                      <EvidencePair
                        company={
                          <CompanyEvidence
                            finding={assessment.listedness}
                            seeSource={seeSource}
                            about={aboutPhrase}
                          />
                        }
                        publicLabel={
                          <PublicEvidence
                            finding={assessment.expectedness}
                            seeSource={seeSource}
                            about={aboutPhrase}
                          />
                        }
                      />
                    </div>

                    {/* What was on the shelf when this search ran. */}
                    {coverage !== null && (
                      <p className="mt-3 text-meta text-slate">
                        {isUncovered(coverage) ? (
                          <span className="text-ink">
                            Nothing is held for {drug?.reportedName} — no
                            company document and no public label — so this
                            search had nothing to read.
                          </span>
                        ) : (
                          <>
                            Searched{" "}
                            {[...coverage.company, ...coverage.publicLabel].map(
                              (doc, index) => (
                                <span key={doc.id}>
                                  {index > 0 && ", "}
                                  <Link
                                    href={`/library/${doc.id}`}
                                    className="text-steady hover:underline"
                                  >
                                    {doc.title}
                                  </Link>
                                </span>
                              ),
                            )}
                            {coverage.company.length === 0 && (
                              <span className="text-ink">
                                {" "}
                                · no company document is held for this product
                              </span>
                            )}
                            {coverage.publicLabel.length === 0 && (
                              <span className="text-ink">
                                {" "}
                                · no public label is held for this product
                              </span>
                            )}
                            .
                          </>
                        )}
                      </p>
                    )}

                    {/*
                      The disagreement, directly under the pair, at --text-base
                      in --ink. CLAUDE.md: when the two documents disagree, that
                      IS the case. It used to render as a note below the header,
                      smaller than the reference number.
                    */}
                    {diverges && (
                      <div className="mt-4 rounded-card border border-rule border-l-[3px] border-l-ink bg-surface px-4 py-3 shadow-card">
                        <p className="text-body font-semibold">
                          The two documents read differently — that is this case.
                        </p>
                        <p className="mt-0.5 text-meta text-slate">
                          {companyDescribes
                            ? "A passage in the company document was identified as describing this reaction; no passage in the FDA label was."
                            : "A passage in the FDA label was identified as describing this reaction; no passage in the company document was."}{" "}
                          The company document is usually updated first, so this
                          is the expected shape of a label that has not caught
                          up. It is a reading of two documents, not a
                          determination about the drug.
                        </p>
                      </div>
                    )}

                    {disagrees && (
                      <div className="mt-4 rounded-card border border-rule border-l-[3px] border-l-ink bg-surface px-4 py-3 shadow-card">
                        <p className="text-body font-semibold">
                          Your ruling splits the two sources.
                        </p>
                        <p className="mt-0.5 text-meta text-slate">
                          You recorded <strong>{listed}</strong> against the
                          company document and <strong>{expected}</strong>{" "}
                          against the FDA label. That is the expected shape of a
                          label that has not caught up — not an error.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* ---- THE DECISION, NEXT ---- */}
              <section aria-label="Ruling" className="mt-8">
                <h2 className="text-h2 font-semibold">Your ruling</h2>
                <p className="mt-1 text-meta text-slate">
                  Nothing above counts as a decision until you record one here.
                  The panels quote documents; they do not decide listedness.
                </p>
                <div className="mt-3">
                  <RulingForm
                    action={rulingAction}
                    blockedReason={blockedReason}
                    receivedAt={record.receivedAt}
                    clockIfUnlisted={clockIfUnlisted}
                    existing={
                      assessment?.ruling == null
                        ? null
                        : {
                            listedness: assessment.ruling.listedness,
                            expectedness: assessment.ruling.expectedness,
                            rationale: assessment.ruling.rationale,
                            decidedBy: assessment.ruling.decidedBy,
                            decidedAt: assessment.ruling.decidedAt,
                          }
                    }
                  />
                </div>

                {/*
                  Close the loop. A reviewer working a shift should never have
                  to go back to the list to reach the next case.
                */}
                {next !== undefined && (
                  <p className="mt-4 text-meta">
                    <Link
                      href={`/case/${next.record.id}`}
                      className="text-steady hover:underline"
                    >
                      Next case: {next.record.reference} —{" "}
                      {next.record.reactions[0]?.verbatimTerm ?? "no reaction"} →
                    </Link>
                  </p>
                )}
              </section>

              {/* ---- THE SUPPORTING EVIDENCE ---- */}
              <section aria-label="Seriousness" className="mt-8">
                <h2 className="text-h2 font-semibold">Why this is serious</h2>
                <div className="mt-3 rounded-card border border-rule bg-surface p-5 shadow-card">
                  <WhyThisIsSerious record={record} />
                </div>
              </section>

              {/* ---- COLLAPSED BY DEFAULT ---- */}
              <div className="mt-6 2xl:hidden">
                <details className="rounded-card border border-rule bg-surface px-4 py-3 shadow-card">
                  <summary className="cursor-pointer font-mono text-micro uppercase tracking-label text-slate hover:text-ink">
                    Case details
                  </summary>
                  <div className="mt-3">
                    <CaseFacts record={record} />
                    <div className="mt-4">
                      <ValidityChecklist record={record} />
                    </div>
                  </div>
                </details>
                <details className="mt-3 rounded-card border border-rule bg-surface px-4 py-3 shadow-card">
                  <summary className="cursor-pointer font-mono text-micro uppercase tracking-label text-slate hover:text-ink">
                    Reporter
                  </summary>
                  <ReporterPanel record={record} />
                </details>
              </div>

              <CaseHistory records={history} />
              <div className="h-8" />
            </div>

            {/*
              The context rail at xl: the facts a reviewer refers to rather
              than reads. Below xl these become the collapsed sections above,
              so nothing is lost — only re-placed.
            */}
            <aside aria-label="Case context" className="hidden 2xl:block">
              <div className="sticky top-32 space-y-3">
                <div className="rounded-card border border-rule bg-surface p-4 shadow-card">
                  <h2 className="font-mono text-micro uppercase tracking-label text-slate">
                    Case details
                  </h2>
                  <div className="mt-2.5">
                    <CaseFacts record={record} />
                  </div>
                </div>
                <div className="rounded-card border border-rule bg-surface p-4 shadow-card">
                  <ValidityChecklist record={record} />
                </div>
                <div className="rounded-card border border-rule bg-surface p-4 shadow-card">
                  <ReporterPanel record={record} />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Where you are in the queue, and how to move without going back to it.
 *
 * Working sixteen cases used to mean sixteen round trips through the list.
 */
function CaseStepper({
  position,
  total,
  previousId,
  nextId,
}: {
  position: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
}) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-micro uppercase tracking-label text-slate">
      {previousId === null ? (
        <span className="opacity-40">‹ prev</span>
      ) : (
        <Link href={`/case/${previousId}`} className="hover:text-steady">
          ‹ prev
        </Link>
      )}
      <span className="tabular-nums">
        {position < 0 ? "—" : `case ${position + 1} of ${total}`}
      </span>
      {nextId === null ? (
        <span className="opacity-40">next ›</span>
      ) : (
        <Link href={`/case/${nextId}`} className="hover:text-steady">
          next ›
        </Link>
      )}
    </div>
  );
}

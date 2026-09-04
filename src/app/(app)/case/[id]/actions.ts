"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit-log";
import { requireSession } from "@/lib/auth";
import { assessThroughService } from "@/lib/assess/service";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { ensurePublicLabel, withAcquiredLabel } from "@/lib/labels/acquire";
import { aiEnv } from "@/lib/assess/env";
import { documentsForDrug } from "@/lib/assess/scope";
import { findQueueEntry } from "@/lib/queue/entries";
import { loadCorpus } from "@/lib/store/corpus";
import { getAssessmentStore } from "@/lib/store/assessment-store";
// Importing this installs the audit journal the History panel reads.
import "@/lib/store/audit-store";
import { canRelease, canWrite } from "@/lib/case/claim";
import { getCaseCoordination } from "@/lib/coordinator";
import { IDEMPOTENCY_FIELD, type AssessActionState } from "./ruling-state";
import type { IsoDateTime } from "@/lib/schemas";
import { todayInAthens } from "@/lib/format/datetime";

/** The instant a claim check is made against. Named so it reads at the call site. */
const nowIso = (): IsoDateTime => new Date().toISOString() as IsoDateTime;

/**
 * The client's key for this intent, or null.
 *
 * Read from the form rather than minted here, because the point is to
 * recognise a REPEAT of one press and only the browser knows that two requests
 * are the same press. A key generated on the server would be new every time
 * and would recognise nothing.
 *
 * Null is a legitimate answer — a caller that sends no key gets the old
 * behaviour, which is correct rather than merely tolerated: nothing about the
 * claim guarantee depends on this.
 */
function idempotencyKeyFrom(formData: FormData | undefined): string | null {
  const raw = formData?.get(IDEMPOTENCY_FIELD);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
import {
  Assessment,
  ReviewerRuling,
  documentStance,
  type IsoDate,
} from "@/lib/schemas";
import {
  INITIAL_CLAIM_STATE,
  type ClaimActionState,
  type RulingState,
} from "./ruling-state";

/**
 * Run the assessment for one case: retrieve, read, store, show.
 *
 * This is the call site the whole `lib/assess` module was written for and
 * went without — the pipeline was complete, tested and unreachable, so every
 * assessment a reviewer saw was a fixture. Nothing about the pipeline changed
 * to make this work; it only needed calling.
 *
 * Deliberately a reviewer-triggered action rather than something that fires on
 * page load. Assessing costs inferences, a reviewer opening a case to check a
 * date should not spend any, and a button makes it obvious that a model ran —
 * which matters more here than saving a click.
 */
export async function runAssessment(
  caseId: string,
  _state: AssessActionState,
  _formData: FormData,
): Promise<AssessActionState> {
  const session = await requireSession();
  const today: IsoDate = todayInAthens();

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) {
    return { status: "skipped", message: "That case could not be found." };
  }

  const { record } = entry;
  const drug = record.drugs[0];
  const reaction = record.reactions[0];

  // A case with no drug or no reaction has nothing to assess. `caseValidity`
  // already tells the reviewer which criterion is missing; silently producing
  // an empty assessment would bury that.
  if (drug === undefined || reaction === undefined) {
    await recordAudit({
      actor: session.reviewerId,
      action: "run_assessment",
      target: record.reference,
      outcome: "rejected",
      detail: { reason: "no suspect drug or no reaction on the case" },
    });
    return {
      status: "skipped",
      message:
        "Nothing to assess: this case has no suspect drug or no reaction recorded.",
    };
  }

  const env = await aiEnv();
  const ai = resolveAiBinding(env);
  const dense = resolveDenseFor(env, ai);

  /*
    Fetch the public FDA label for this drug before assessing, if we do not
    already hold one.

    Expectedness is a question about the public label, and until now it could
    only be answered for the two products baked into the fixtures — every real
    drug returned `source_unavailable`, which is honest but useless. This is
    what makes the company-versus-public comparison possible for a real
    medicine. It never blocks: a failure leaves the corpus as it was and the
    finding degrades exactly as it did before.
  */
  const beforeFetch = await loadCorpus();
  const label = await ensurePublicLabel({
    drugName: drug.activeSubstance ?? drug.reportedName,
    held: beforeFetch.documents,
    dense,
    actor: session.reviewerId,
  });

  // Reloaded after the fetch so a label acquired just now is in scope for this
  // assessment rather than only the next one.
  const { chunks, documents } =
    label.status === "acquired" ? await loadCorpus() : beforeFetch;

  /*
    Widened with the label the fetch above resolved, for the reason
    `withAcquiredLabel` gives. It matters most here for the salt forms FDA
    files labels under: a case recording "abacavir" and a label filed as
    "abacavir sulfate" are one medicine, and without this the assessment
    fetched the right label and then reported expectedness as
    `source_unavailable` — "no public document is held" about a document it
    had just stored.
  */
  const inScope = withAcquiredLabel(documentsForDrug(documents, drug), label);

  /*
    The SPL set id of the public label this assessment actually read.

    It was hardcoded null, because there was no real label to identify. Now the
    document id IS the SPL set id, so the expectedness finding can carry the
    exact FDA record it came from — which is what the evidence panel prints
    under the quote and what lets anyone verify the citation against
    openFDA independently.
  */
  const publicDoc = documents.find(
    (d) => d.sourceType === "public" && inScope.has(d.id),
  );

  /*
    Through the service seam, not straight into `assessCase`.

    `assessThroughService` calls the `sidenote-assess` Worker when its binding
    is there and runs the identical code in-process when it is not — which is
    every run under `next dev` and every run in the test suite. The `ai`,
    `dense` and `gateway` values below are only used on the in-process path;
    the remote path resolves its own from its own bindings, which is the point
    of moving it, and is why this app can hold no model credentials at all.
  */
  const findings = await assessThroughService({
    chunks,
    documentIds: inScope,
    reactionTerm: reaction.verbatimTerm,
    drugName: drug.reportedName,
    documentKind:
      drug.marketingStatus === "marketed" ? "ccds" : "investigators_brochure",
    labelSetId: publicDoc?.id ?? null,
    ai,
    dense,
    gateway: resolveGateway(env),
    now: new Date().toISOString(),
    actor: session.reviewerId,
    target: record.reference,
  });

  const existing = await (await getAssessmentStore()).get(record.id);
  const now = new Date().toISOString();

  await (await getAssessmentStore()).put(
    Assessment.parse({
      id: existing?.id ?? randomUUID(),
      caseId: record.id,
      reactionId: reaction.id,
      drugId: drug.id,
      listedness: findings.listedness,
      expectedness: findings.expectedness,
      /*
        A re-run replaces the evidence, never the verdict.

        If a reviewer has already ruled, that ruling survives a fresh
        assessment — the model does not get to un-decide something a human
        decided, and a ruling made on older passages is still that reviewer's
        ruling. What changes is the evidence shown beneath it, which is
        exactly what a re-run is for.
      */
      ruling: existing?.ruling ?? entry.assessment?.ruling ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );

  await recordAudit({
    actor: session.reviewerId,
    action: "run_assessment",
    target: record.reference,
    outcome: "success",
    detail: {
      source: ai.source,
      // Which retrieval a reviewer's evidence came from. `assessCase` records
      // the per-namespace detail; this is the one line that says whether the
      // dense half was available for this run at all.
      retrieval: dense.store === null ? "lexical" : `hybrid:${dense.source}`,
      // Where the public half of the evidence came from.
      publicLabel: label.status,
      listedness: findings.listedness.state,
      expectedness: findings.expectedness.state,
    },
  });

  revalidatePath(`/case/${record.id}`);
  revalidatePath("/queue");

  /*
    What the run found, in the words the panels use.

    Built from `documentStance` rather than from a second reading of the
    findings, so this cannot say something the screen below does not show. It
    reports what each source SAYS and stops there: no listedness, no
    expectedness, no expedited status. Those are the reviewer's, and a summary
    that reached one would be the model deciding out loud.
  */
  const says = (stance: ReturnType<typeof documentStance>): string =>
    stance === "describes"
      ? "describes this reaction"
      : stance === "silent"
        ? "does not appear to mention it"
        : "could not be read";

  /*
    And what a re-run did NOT change.

    This sentence used to be the literal "Nothing has been ruled.", appended
    unconditionally — so re-assessing a case that carried a ruling announced
    that no ruling existed, in an aria-live region, directly above the ruling
    itself. The verdict was intact; the sentence was simply false, and it was
    false about the one field in this application only a human may write.

    `standing` is the same value written to the store thirty lines above, so
    the sentence and the record cannot disagree. It names the reviewer rather
    than saying "your ruling", because the person re-running an assessment is
    frequently not the person who ruled — this is a shared queue, and telling
    one reviewer that another's determination is theirs is how a determination
    quietly changes hands.

    It reports the determination and stops there: whether it still fits the
    evidence this run retrieved is the reviewer's to judge, and a summary that
    reached for that would be the model marking a human's work.
  */
  const standing = existing?.ruling ?? entry.assessment?.ruling ?? null;
  const verdict =
    standing === null
      ? "Nothing has been ruled."
      : `The ruling recorded by ${standing.decidedBy} — ` +
        `${standing.listedness}, ${standing.expectedness} — still stands.`;

  return {
    status: "assessed",
    message:
      `Assessment complete. The company documents ` +
      `${says(documentStance(findings.listedness))}; the public label ` +
      `${says(documentStance(findings.expectedness))}. ${verdict}`,
  };
}


// ---------------------------------------------------------------------------
// Claiming: one case, one reviewer
// ---------------------------------------------------------------------------

/**
 * Take the case, or find out who has it.
 *
 * Losing the race is a normal outcome rather than an error. The action returns
 * who holds it and since when, and the screen renders that in place — which is
 * the interaction CLAUDE.md calls the central conflict this app exists to
 * resolve, and the one it is worth making look deliberate.
 *
 * The read-then-write this used to describe is gone: `idFromName(caseId)`
 * gives one object per case whose methods cannot run concurrently, so the
 * check and the write happen in one turn and the window cannot be expressed.
 */
export async function claimCase(
  caseId: string,
  _previous: ClaimActionState,
  formData?: FormData,
): Promise<ClaimActionState> {
  const session = await requireSession();
  const today: IsoDate = todayInAthens();

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) return INITIAL_CLAIM_STATE;

  /*
    The coordinator is the only thing that decides this, and now the only
    thing the screens read as well.

    `idFromName(caseId)` gives one object per case whose methods cannot run
    concurrently, so the check and the write are one turn. Where no Durable
    Object is bound the stand-in answers instead and says `arbitrates: false`,
    which the claim panel prints under the control — for a while nothing did,
    and three comments including this one said otherwise.

    The write used to land here and the screens used to read a separate
    filesystem store, with nothing copying one into the other, so claiming a
    case changed nothing anybody could see. That store is gone; the queue reads
    the `claims` mirror these objects write, and the case screen reads the
    object.
  */
  const coordination = await getCaseCoordination();
  const { result: outcome, replayed } = await coordination.claim(
    caseId,
    session.reviewerId,
    session.displayName,
    idempotencyKeyFrom(formData),
  );

  /*
    A replay is recorded as a replay, not as a second grant.

    The coordinator recognised this submission as one it had already answered
    and did not run it again, so writing `result: "granted"` here a second time
    would put a grant in the log that never happened. The line is still
    emitted, because a retry that reached the server IS an event worth having;
    what changes is that it says which one it was.
  */
  await recordAudit({
    actor: session.reviewerId,
    action: "claim_case",
    target: entry.record.reference,
    // Losing the race is a refusal, not a failure: the system worked.
    outcome: outcome.kind === "held_by_other" ? "rejected" : "success",
    detail: {
      result: outcome.kind,
      heldBy: outcome.claim.reviewerId,
      ...(replayed ? { replayed: true } : {}),
    },
  });

  revalidatePath(`/case/${caseId}`);
  revalidatePath("/queue");

  return {
    status: outcome.kind,
    message:
      outcome.kind === "held_by_other"
        ? `${outcome.claim.displayName} claimed this case first.`
        : null,
  };
}

/** Put the case down. Only the holder may, and doing it twice is not an error. */
export async function releaseCase(
  caseId: string,
  _previous: ClaimActionState,
  formData?: FormData,
): Promise<ClaimActionState> {
  const session = await requireSession();
  const today: IsoDate = todayInAthens();

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) return INITIAL_CLAIM_STATE;

  const coordination = await getCaseCoordination();
  const current = (await coordination.state(caseId)).claim;
  if (!canRelease(current, session.reviewerId, nowIso())) {
    await recordAudit({
      actor: session.reviewerId,
      action: "release_case",
      target: entry.record.reference,
      outcome: "rejected",
      detail: { reason: "not the holder" },
    });
    return {
      status: "held_by_other",
      message: "You cannot release a case somebody else holds.",
    };
  }

  const released = await coordination.release(
    caseId,
    session.reviewerId,
    idempotencyKeyFrom(formData),
  );
  await recordAudit({
    actor: session.reviewerId,
    action: "release_case",
    target: entry.record.reference,
    outcome: "success",
    ...(released.replayed ? { detail: { replayed: true } } : {}),
  });

  revalidatePath(`/case/${caseId}`);
  revalidatePath("/queue");
  return { status: "released", message: null };
}

// ---------------------------------------------------------------------------
// The ruling: the one place a determination is written
// ---------------------------------------------------------------------------

/**
 * Record a reviewer's ruling.
 *
 * Validated with the SAME `ReviewerRuling` schema the client form is built
 * against — non-negotiable #2 — and the validation genuinely runs here, over
 * `FormData` that anybody could have posted. The claim check is the one that
 * matters most: a disabled button is a courtesy to the reviewer, not a
 * control, and the server is where "somebody else holds this case" is actually
 * enforced.
 *
 * A ruling requires an assessment to attach to. That is not a technicality —
 * it means a determination cannot be recorded about a case whose documents
 * have never been searched.
 */
export async function recordRuling(
  caseId: string,
  _previous: RulingState,
  form: FormData,
): Promise<RulingState> {
  const session = await requireSession();
  const today: IsoDate = todayInAthens();

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) {
    return { status: "rejected", error: "That case no longer exists." };
  }

  const coordination = await getCaseCoordination();
  const claim = (await coordination.state(caseId)).claim;
  if (!canWrite(claim, session.reviewerId, nowIso())) {
    await recordAudit({
      actor: session.reviewerId,
      action: "rule_case",
      target: entry.record.reference,
      outcome: "rejected",
      detail: { reason: "case not held by this reviewer" },
    });
    return {
      status: "rejected",
      error:
        claim === null
          ? "Claim this case before recording a ruling."
          : `${claim.displayName} holds this case, so it cannot be ruled on here.`,
    };
  }

  const parsed = ReviewerRuling.safeParse({
    listedness: form.get("listedness"),
    expectedness: form.get("expectedness"),
    rationale: (form.get("rationale") ?? "").toString().trim(),
    decidedBy: session.reviewerId,
    decidedAt: new Date().toISOString(),
  });
  if (!parsed.success) {
    await recordAudit({
      actor: session.reviewerId,
      action: "rule_case",
      target: entry.record.reference,
      outcome: "rejected",
      detail: { reason: "ruling failed validation" },
    });
    return {
      status: "rejected",
      error:
        "That ruling could not be recorded. A determination and a reason are both required.",
    };
  }

  const store = await getAssessmentStore();
  const existing = (await store.get(caseId)) ?? entry.assessment;
  if (existing === null) {
    return {
      status: "rejected",
      error:
        "This case has not been assessed, so there is no evidence to rule on. Press Assess this case first.",
    };
  }

  /*
    The coordinator is the authority; the assessment store is the queryable
    copy.

    Ordered this way on purpose. The coordinator re-checks the claim inside a
    single-threaded turn, so a claim that lapsed between the check above and
    this line is caught HERE rather than being written and discovered later —
    which is the whole reason a lapse is safe to have at all. Only once it has
    accepted is the mirror updated.
  */
  const { result: ruled, replayed } = await coordination.rule(
    caseId,
    parsed.data,
    idempotencyKeyFrom(form),
  );
  if (!ruled.ok) {
    await recordAudit({
      actor: session.reviewerId,
      action: "rule_case",
      target: entry.record.reference,
      outcome: "rejected",
      detail: { reason: ruled.reason ?? "refused by the coordinator" },
    });
    return {
      status: "rejected",
      error: ruled.reason ?? "That ruling could not be recorded.",
    };
  }

  /*
    A REPLAY WRITES NOTHING AND RECORDS NOTHING NEW.

    Everything below used to run on a replayed submission: the mirror was
    re-written with a fresh `updatedAt`, and a second `rule_case` success line
    was emitted at a second instant. The coordinator was idempotent and the two
    things that make a ruling visible were not — so a double-click produced an
    audit trail saying the determination was made twice, which case-coordinator
    .ts names as exactly the defect the mechanism exists to prevent.

    Returning early rather than skipping each write in turn: there is one
    decision here, and it was already recorded the first time.
  */
  if (replayed) {
    await recordAudit({
      actor: session.reviewerId,
      action: "rule_case",
      target: entry.record.reference,
      outcome: "success",
      detail: { replayed: true },
    });
    // Still revalidated. Nothing changed on the server, but the client that
    // retried has not necessarily seen the first result, and re-rendering a
    // page that is already correct costs nothing.
    revalidatePath(`/case/${caseId}`);
    revalidatePath("/queue");
    return { status: "recorded", error: null };
  }

  await store.put(
    Assessment.parse({
      ...existing,
      ruling: parsed.data,
      updatedAt: new Date().toISOString(),
    }),
  );

  await recordAudit({
    actor: session.reviewerId,
    action: "rule_case",
    target: entry.record.reference,
    outcome: "success",
    detail: {
      listedness: parsed.data.listedness,
      expectedness: parsed.data.expectedness,
      /*
        Whether this ruling started a regulatory clock. The single most
        consequential fact about a ruling, and the reason the audit line for
        one is worth more than the line for any other mutation here.
      */
      startsExpeditedClock:
        parsed.data.listedness === "unlisted" &&
        entry.record.reactions.some((r) =>
          Object.values(r.seriousness).some(
            (flag) => flag !== null && !flag.rejectedByReviewer,
          ),
        ),
      day0: entry.record.receivedAt,
    },
  });

  revalidatePath(`/case/${caseId}`);
  revalidatePath("/queue");
  return { status: "recorded", error: null };
}

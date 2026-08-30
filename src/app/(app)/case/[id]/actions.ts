"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { assessCase } from "@/lib/assess/assess";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { ensurePublicLabel, withAcquiredLabel } from "@/lib/labels/acquire";
import { aiEnv } from "@/lib/assess/env";
import { documentsForDrug } from "@/lib/assess/scope";
import { findQueueEntry } from "@/lib/queue/entries";
import { loadCorpus } from "@/lib/store/corpus";
import { getAssessmentStore } from "@/lib/store/assessment-store";
import { getClaimStore } from "@/lib/store/claim-store";
// Importing this installs the audit journal the History panel reads.
import "@/lib/store/audit-store";
import { canRelease, canWrite, claimOutcome } from "@/lib/case/claim";
import type { IsoDateTime } from "@/lib/schemas";

/** The instant a claim check is made against. Named so it reads at the call site. */
const nowIso = (): IsoDateTime => new Date().toISOString() as IsoDateTime;
import {
  Assessment,
  ReviewerRuling,
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
export async function runAssessment(caseId: string): Promise<void> {
  const session = await requireSession();
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) return;

  const { record } = entry;
  const drug = record.drugs[0];
  const reaction = record.reactions[0];

  // A case with no drug or no reaction has nothing to assess. `caseValidity`
  // already tells the reviewer which criterion is missing; silently producing
  // an empty assessment would bury that.
  if (drug === undefined || reaction === undefined) {
    audit({
      actor: session.reviewerId,
      action: "run_assessment",
      target: record.reference,
      outcome: "rejected",
      detail: { reason: "no suspect drug or no reaction on the case" },
    });
    return;
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

  const findings = await assessCase({
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

  const existing = await getAssessmentStore().get(record.id);
  const now = new Date().toISOString();

  await getAssessmentStore().put(
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

  audit({
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
 * The read-then-write below is not atomic, and `claim-store.ts` says so at
 * length. `idFromName(caseId)` in Cluster D is what closes that window; this
 * action's shape does not change when it does.
 */
export async function claimCase(
  caseId: string,
  _previous: ClaimActionState,
): Promise<ClaimActionState> {
  const session = await requireSession();
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) return INITIAL_CLAIM_STATE;

  const store = await getClaimStore();
  const outcome = claimOutcome({
    current: await store.get(caseId),
    reviewerId: session.reviewerId,
    displayName: session.displayName,
    now: new Date().toISOString(),
  });

  if (outcome.kind === "granted") {
    await store.put(caseId, outcome.claim);
  }

  audit({
    actor: session.reviewerId,
    action: "claim_case",
    target: entry.record.reference,
    // Losing the race is a refusal, not a failure: the system worked.
    outcome: outcome.kind === "held_by_other" ? "rejected" : "success",
    detail: { result: outcome.kind, heldBy: outcome.claim.reviewerId },
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
): Promise<ClaimActionState> {
  const session = await requireSession();
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) return INITIAL_CLAIM_STATE;

  const store = await getClaimStore();
  const current = await store.get(caseId);
  if (!canRelease(current, session.reviewerId, nowIso())) {
    audit({
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

  await store.clear(caseId);
  audit({
    actor: session.reviewerId,
    action: "release_case",
    target: entry.record.reference,
    outcome: "success",
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
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  const entry = await findQueueEntry(today, caseId);
  if (entry === null) {
    return { status: "rejected", error: "That case no longer exists." };
  }

  const claim = await (await getClaimStore()).get(caseId);
  if (!canWrite(claim, session.reviewerId, nowIso())) {
    audit({
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
    audit({
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

  const store = getAssessmentStore();
  const existing = (await store.get(caseId)) ?? entry.assessment;
  if (existing === null) {
    return {
      status: "rejected",
      error:
        "This case has not been assessed, so there is no evidence to rule on. Press Assess this case first.",
    };
  }

  await store.put(
    Assessment.parse({
      ...existing,
      ruling: parsed.data,
      updatedAt: new Date().toISOString(),
    }),
  );

  audit({
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

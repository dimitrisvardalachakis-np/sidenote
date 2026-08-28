"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { assessCase } from "@/lib/assess/assess";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { ensurePublicLabel } from "@/lib/labels/acquire";
import { aiEnv } from "@/lib/assess/env";
import { documentsForDrug } from "@/lib/assess/scope";
import { findQueueEntry } from "@/lib/queue/entries";
import { loadCorpus } from "@/lib/store/corpus";
import { getAssessmentStore } from "@/lib/store/assessment-store";
import { Assessment, type IsoDate } from "@/lib/schemas";

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

  const inScope = documentsForDrug(documents, drug);

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

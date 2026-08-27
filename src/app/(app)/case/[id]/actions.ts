"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { assessCase } from "@/lib/assess/assess";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
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

  const { chunks, documents } = await loadCorpus();
  const env = await aiEnv();
  const ai = resolveAiBinding(env);

  const findings = await assessCase({
    chunks,
    documentIds: documentsForDrug(documents, drug),
    reactionTerm: reaction.verbatimTerm,
    drugName: drug.reportedName,
    documentKind:
      drug.marketingStatus === "marketed" ? "ccds" : "investigators_brochure",
    labelSetId: null,
    ai,
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
      listedness: findings.listedness.state,
      expectedness: findings.expectedness.state,
    },
  });

  revalidatePath(`/case/${record.id}`);
  revalidatePath("/queue");
}

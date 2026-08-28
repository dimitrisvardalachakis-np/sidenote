"use server";

import { audit } from "@/lib/audit";
import {
  advance,
  extractDrug as intakeDrug,
  type IntakeState,
} from "@/lib/intake/conversation";
import { documentsForDrug } from "@/lib/assess/scope";
import { intakeToCase } from "@/lib/intake/to-case";
import { loadCorpus } from "@/lib/store/corpus";
import { getCaseStore } from "@/lib/store/case-store";
import { guardPublicConversation } from "@/lib/protection/guard";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
import { ensurePublicLabel } from "@/lib/labels/acquire";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { aiEnv } from "@/lib/assess/env";
import { extractReport } from "@/lib/extract/extract";
import type { ChatState } from "./chat-state";

/**
 * Advance the intake conversation by one reporter message.
 *
 * The conversation state round-trips through the client, which is safe here
 * for two reasons worth stating. First, the reporter is anonymous and the
 * state describes only their own in-progress report, so tampering with it
 * harms nobody else. Second — and this is the one that matters — the citations
 * are recomputed on the server on every turn with audience "public", so a
 * client cannot inject company-confidential text into its own transcript and
 * cannot cause any to be retrieved.
 *
 * The conversation is a state machine with a model layered over it. The state
 * machine decides which question comes next and is pure; the model reads the
 * reporter's prose for fields no pattern list can reach. When the model is
 * absent, disabled, slow, or returns something that fails verification, the
 * deterministic extraction underneath runs exactly as it always has and the
 * report is accepted regardless — non-negotiable #8.
 */
export async function sendChatMessage(
  previous: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const raw = formData.get("message");
  const reply = typeof raw === "string" ? raw.trim() : "";
  if (reply.length === 0) return previous;
  if (previous.submitted !== null) return previous;

  // The chat is anonymous and takes many turns, so it gets its own looser
  // ceiling. Checked before any retrieval runs: search is the expensive part
  // and doing it for an unthrottled caller is doing their work for them.
  const guard = await guardPublicConversation();
  if (!guard.allowed) {
    return { ...previous, error: guard.message };
  }

  let { chunks, documents, products } = await loadCorpus();

  /*
    Fetch the reporter's medicine from openFDA the moment they name it.

    Without this the chat could only answer for the products baked into the
    fixtures, so a reporter naming any real medicine was told their reaction is
    not in the published information — an assertion about a label nobody held.
    That is the false-negative half of the same two-state collapse NOTES.md
    records for this path, and fetching the label is what removes it.

    It never blocks the conversation: a failure leaves the corpus untouched and
    the reply is exactly what it would have been before.
  */
  const namedDrug =
    previous.intake.slots.drug ?? intakeDrug(reply, products) ?? null;
  if (namedDrug !== null) {
    const env = await aiEnv();
    const fetched = await ensurePublicLabel({
      drugName: namedDrug,
      held: documents,
      dense: resolveDenseFor(env, resolveAiBinding(env)),
      actor: "public",
    });
    if (fetched.status === "acquired") {
      ({ chunks, documents, products } = await loadCorpus());
    }
  }

  /*
    Extraction runs only on the reporter's opening account. That is the text
    `Case.narrative` stores, and seriousness spans index into it — running the
    model over a one-word answer to "how old are they?" would produce offsets
    into a string nothing keeps.

    Failure is not handled here because there is nothing to handle: a null
    extraction is what `advance` already expects, and the regex path is what
    runs. The report is accepted either way.
  */
  const ai = resolveAiBinding(await aiEnv());
  const extraction =
    previous.intake.pending === "narrative"
      ? (
          await extractReport({
            binding: ai.binding,
            unavailableReason: ai.reason ?? "no model configured",
            gateway: resolveGateway(await aiEnv()),
            sourceText: reply,
            knownProducts: products,
            now: new Date().toISOString(),
          })
        ).extraction
      : null;

  const intake: IntakeState = advance({
    state: previous.intake,
    reply,
    corpus: chunks,
    knownProducts: products,
    // The public chat. Company documents are never searched or quoted here.
    audience: "public",
    extraction,
    /*
      Scope retrieval to documents held for the medicine the reporter named.

      Without this the chat could tell somebody their novel reaction "does
      appear in the published information" on the strength of a different
      product's label. That is the answer most likely to make a person decide
      not to bother reporting, so it is the one that must not be wrong.
    */
    scope:
      previous.intake.slots.drug === null && intakeDrug(reply, products) === null
        ? null
        : documentsForDrug(documents, {
            reportedName:
              previous.intake.slots.drug ?? intakeDrug(reply, products) ?? "",
            activeSubstance: null,
          }),
  });

  if (intake.phase !== "complete") {
    return { intake, submitted: null, error: null };
  }

  // The conversation is finished, so the case gets written. This happens
  // regardless of what retrieval found: non-negotiable #4 — the model never
  // decides, and "already described" is not a reason to discard a report.
  const now = new Date();
  const store = getCaseStore();

  try {
    const reference = await store.nextReference(now.getUTCFullYear());
    const record = intakeToCase({
      slots: intake.slots,
      reference,
      receivedAt: now.toISOString().slice(0, 10),
      now: now.toISOString(),
      ids: {
        caseId: crypto.randomUUID(),
        drugId: crypto.randomUUID(),
        reactionId: crypto.randomUUID(),
      },
    });
    await store.put(record);

    audit({
      actor: "public",
      action: "submit_report_chat",
      target: reference,
      outcome: "success",
      detail: {
        alreadyDescribed: intake.verdict?.alreadyDescribed ?? false,
        seriousFlags: intake.slots.seriousness?.length ?? 0,
        turns: intake.messages.filter((m) => m.role === "reporter").length,
        // Which path structured this report, so a case can be traced to the
        // thing that read it.
        extractedBy: extraction === null ? "patterns" : extraction.model,
        evidencedFlags: intake.slots.seriousnessEvidence.length,
      },
    });

    return {
      intake,
      submitted: { reference, caseId: record.id },
      error: null,
    };
  } catch {
    audit({
      actor: "public",
      action: "submit_report_chat",
      target: "intake_chat",
      outcome: "failure",
    });
    // The conversation is preserved so nothing the reporter typed is lost.
    return {
      intake,
      submitted: null,
      error:
        "We could not save your report just then. Nothing you typed has been lost — press send again.",
    };
  }
}

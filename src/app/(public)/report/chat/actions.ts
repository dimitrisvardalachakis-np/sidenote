"use server";

import { audit } from "@/lib/audit";
import {
  advance,
  prefillFromSlots,
  reopen,
  type IntakeSlot,
  type IntakeState,
} from "@/lib/intake/conversation";
import { documentsForDrug } from "@/lib/assess/scope";
import { intakeToCase } from "@/lib/intake/to-case";
import { loadCorpus } from "@/lib/store/corpus";
import { getCaseStore } from "@/lib/store/case-store";
import { guardPublicConversation } from "@/lib/protection/guard";
import { resolveAiBinding, resolveGateway } from "@/lib/assess/ai";
import {
  type AcquireOutcome,
  ensurePublicLabel,
  withAcquiredLabel,
} from "@/lib/labels/acquire";
import { answerPublicQuestion } from "@/lib/assess/answer";
import {
  publicDocumentsInScope,
  reviewIsCurrent,
  reviewOutcome,
  type ChatReview,
} from "@/lib/intake/review";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { CarriedSlots, parseIntent } from "./chat-state";
import { aiEnv } from "@/lib/assess/env";
import { extractReport } from "@/lib/extract/extract";
import type { ChatState } from "./chat-state";

/**
 * The intake conversation, as one Server Action with three intents.
 *
 * ONE action rather than three, because the state round-trips through
 * `useActionState` and a second hook would hold its own copy of it. Two
 * reducers over one conversation is two answers to "what has the reporter
 * said", and they diverge the moment either is used.
 *
 * The conversation state round-tripping through the client is safe here for
 * two reasons worth restating. First, the reporter is anonymous and the state
 * describes only their own in-progress report, so tampering with it harms
 * nobody else. Second — and this is the one that matters — retrieval and the
 * citations are recomputed on the server whenever the review is produced, and
 * `answerPublicQuestion` searches the public namespace only, so a client
 * cannot inject company-confidential text into its own transcript and cannot
 * cause any to be retrieved.
 *
 * The conversation is a state machine with a model layered over it. The state
 * machine decides which question comes next and is pure; the model reads the
 * reporter's prose for fields no pattern list can reach, and reads the
 * retrieved passages before anything is claimed about a label. When the model
 * is absent, disabled, slow, or returns something that fails verification, the
 * deterministic extraction underneath runs exactly as it always has, the
 * review says plainly that no reading could be produced, and the report is
 * accepted regardless — non-negotiable #8.
 */
export async function sendChatMessage(
  previous: ChatState,
  formData: FormData,
): Promise<ChatState> {
  if (previous.submitted !== null) return previous;

  // Checked before the intent, because a change button carries a slot rather
  // than an intent — see the note on CHAT_INTENTS.
  const change = formData.get("change");
  if (typeof change === "string" && change.length > 0) {
    return changeAnswer(previous, change);
  }

  switch (parseIntent(formData.get("intent"))) {
    case "submit":
      return submitReport(previous);
    case "message":
      return addMessage(previous, formData);
  }
}

/**
 * Fold slots the form already knew into a conversation that has not started.
 *
 * `formData` is untrusted — anybody can post to a server action — so the
 * payload is parsed rather than cast, and a malformed one is ignored instead
 * of throwing.
 *
 * IT LANDS IN `prefill`, NEVER IN `slots`, and that distinction is the whole
 * repair. It used to be merged into the answers themselves, so a form report
 * sent days earlier — a draft that never expires once submitted — filled every
 * slot on the first turn. `nextMissing` then found nothing missing, the
 * conversation ended after one question, and the case was filed against
 * "amoxil" over a narrative that named abacavir. A suggestion is now asked
 * about like everything else, and the worst a hostile value can do is put a
 * wrong word on a chip the reporter can decline.
 */
function mergePrefill(
  previous: ChatState,
  raw: FormDataEntryValue | null,
): ChatState {
  // Only before the reporter has said anything. Once they are typing, what
  // they type wins over anything a previous page thought it knew.
  if (previous.intake.messages.some((m) => m.role === "reporter")) return previous;
  if (typeof raw !== "string" || raw.length === 0) return previous;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return previous;
  }

  const result = CarriedSlots.safeParse(parsed);
  if (!result.success) return previous;

  return {
    ...previous,
    intake: {
      ...previous.intake,
      prefill: prefillFromSlots({
        ...previous.intake.slots,
        ...result.data,
      }),
    },
  };
}

async function addMessage(
  previous: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const raw = formData.get("message");
  const reply = typeof raw === "string" ? raw.trim() : "";
  if (reply.length === 0) return previous;

  /*
    What the form already collected, carried in on the first turn.

    The chat's state lives in this action's return value, not in the browser,
    so the panel cannot seed it directly — it sends what it knows instead, and
    the merge happens here where it can be validated.
  */
  const carried = mergePrefill(previous, formData.get("known"));

  // The chat is anonymous and takes many turns, so it gets its own looser
  // ceiling. Checked before any retrieval or generation runs: both are the
  // expensive part and doing them for an unthrottled caller is doing their
  // work for them.
  const guard = await guardPublicConversation();
  if (!guard.allowed) {
    return { ...previous, error: guard.message };
  }

  const { products } = await loadCorpus();

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
    carried.intake.pending === "narrative"
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
    state: carried.intake,
    reply,
    knownProducts: products,
    extraction,
  });

  const next: ChatState = {
    ...carried,
    intake,
    error: null,
    extractedBy:
      extraction === null
        ? (carried.extractedBy ?? (carried.intake.pending === "narrative" ? "patterns" : null))
        : extraction.model,
  };

  if (intake.phase !== "review") return next;
  return { ...next, review: await buildReview(next) };
}

/**
 * What the published information says about this reaction, for this medicine.
 *
 * The same four steps the public search page takes, in the same order and
 * through the same functions: fetch the label if we do not hold it, scope to
 * the documents that govern this product, retrieve, and have a model read what
 * came back. Reusing `answerPublicQuestion` rather than reimplementing it is
 * what brings the verbatim-span check, the single retry, the recommendation
 * filter and the honest degraded state onto this path unchanged — and its
 * `sourceType: "public"` filter is a second lock on the confidentiality
 * boundary, independent of the scope computed here.
 *
 * Never throws. A reporter must be able to send their report when openFDA is
 * down and when the model is down, so every failure below becomes a state the
 * screen can render rather than an exception that loses the conversation.
 */
async function buildReview(state: ChatState): Promise<ChatReview | null> {
  const { drug, reaction } = state.intake.slots;
  if (drug === null || reaction === null) return null;

  // Nothing about a reading changes when the reporter corrects their own name,
  // and a model call is a cost somebody pays. Recompute only for the two
  // answers a reading is actually about.
  if (reviewIsCurrent(state.review, state.intake.slots)) return state.review;

  try {
    const env = await aiEnv();
    let { chunks, documents } = await loadCorpus();

    /*
      Fetch the reporter's medicine from openFDA, once, at the point it is
      needed. Without this the chat could only answer for the products baked
      into the fixtures, so a reporter naming any real medicine was told their
      reaction is not in the published information — an assertion about a label
      nobody held.
    */
    let acquired: AcquireOutcome | null = null;
    acquired = await ensurePublicLabel({
      drugName: drug,
      held: documents,
      dense: resolveDenseFor(env, resolveAiBinding(env)),
      actor: "public",
    });
    if (acquired.status === "acquired") {
      ({ chunks, documents } = await loadCorpus());
    }

    /*
      Scope retrieval to documents held for the medicine the reporter named.

      Without this the chat could tell somebody their novel reaction "does
      appear in the published information" on the strength of a different
      product's label. That is the answer most likely to make a person decide
      not to bother reporting, so it is the one that must not be wrong.

      The label just fetched is pinned in, for the reason `withAcquiredLabel`
      gives: openFDA resolved that record from this very name, which is better
      evidence than matching the name back against the record afterwards.
    */
    const scope = withAcquiredLabel(
      documentsForDrug(documents, {
        reportedName: drug,
        activeSubstance: null,
      }),
      acquired,
    );

    const answer = await answerPublicQuestion(reaction, chunks, undefined, scope);

    return {
      outcome: reviewOutcome({
        publicDocumentsInScope: publicDocumentsInScope(documents, scope),
        answer,
      }),
      citations: answer.citations,
      narrative: answer.narrative,
      drug,
      computedFor: { drug, reaction },
    };
  } catch (cause) {
    /*
      An outage is not a document saying nothing. A failure here produces the
      state that says a reading could not be produced — never the state that
      says the label is silent — and the report can still be sent.
    */
    audit({
      actor: "public",
      action: "review_report_chat",
      target: drug,
      outcome: "failure",
      detail: {
        reason:
          cause instanceof Error ? cause.message : "unknown failure while reading",
      },
    });
    return {
      outcome: {
        kind: "unreadable",
        reason: "the published information could not be searched just now",
      },
      citations: [],
      narrative: null,
      drug,
      computedFor: { drug, reaction },
    };
  }
}

/**
 * Re-ask one question from the review screen.
 *
 * The slot name arrives from a form field and is therefore untrusted; `reopen`
 * is only reached through a name the state machine itself declares.
 */
function changeAnswer(previous: ChatState, slot: string): ChatState {
  if (!isIntakeSlot(slot)) return previous;
  return { ...previous, intake: reopen(previous.intake, slot), error: null };
}

const SLOTS: readonly string[] = [
  "narrative",
  "drug",
  "reaction",
  "age",
  "sex",
  "seriousness",
  "reporterName",
  "reporterContact",
];

function isIntakeSlot(value: string): value is IntakeSlot {
  return SLOTS.includes(value);
}

/**
 * File the case. The one write in this whole flow, and now the one the
 * reporter asks for.
 *
 * It used to happen in the same turn that produced the closing message, which
 * is what let a stale draft file a report against a medicine nobody named
 * before anybody could look at it. Nothing is written until this runs.
 *
 * Non-negotiable #4 is unchanged and is why the send control is offered in the
 * same words whatever the reading said: "already described" is not a reason to
 * discard a report, and this action does not consult the review at all.
 */
async function submitReport(previous: ChatState): Promise<ChatState> {
  if (previous.intake.phase !== "review") return previous;

  const guard = await guardPublicConversation();
  if (!guard.allowed) {
    return { ...previous, error: guard.message };
  }

  const intake = previous.intake;
  const now = new Date();
  const store = await getCaseStore();

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
        // What the reporter was shown before they pressed send, in the
        // vocabulary of the three honest states rather than a boolean.
        labelReading: previous.review?.outcome.kind ?? "not_computed",
        seriousFlags: intake.slots.seriousness?.length ?? 0,
        turns: intake.messages.filter((m) => m.role === "reporter").length,
        // Which path structured this report, so a case can be traced to the
        // thing that read it.
        extractedBy: previous.extractedBy ?? "patterns",
        evidencedFlags: intake.slots.seriousnessEvidence.length,
      },
    });

    return {
      ...previous,
      intake: { ...intake, phase: "complete" },
      submitted: { reference, caseId: record.id },
      error: null,
    };
  } catch (cause) {
    /*
      Record WHY, not just that.

      This was a bare `catch {}` writing `outcome: "failure"` with no detail,
      so a reporter saw "we could not save your report" and the operator saw a
      failure line with nothing on it. Every other failure path in this
      codebase names its reason; this one — the single most consequential
      failure the app has, a safety report not being written — named nothing,
      and diagnosing it meant reproducing it.
    */
    audit({
      actor: "public",
      action: "submit_report_chat",
      target: "intake_chat",
      outcome: "failure",
      detail: {
        reason:
          cause instanceof Error ? cause.message : "unknown failure while saving",
      },
    });
    // The conversation is preserved so nothing the reporter typed is lost.
    return {
      ...previous,
      error:
        "We could not save your report just then. Nothing you typed has been lost — press send again.",
    };
  }
}

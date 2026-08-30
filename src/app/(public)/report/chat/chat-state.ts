import { z } from "zod";
import { SeriousnessCriterion } from "@/lib/schemas";
import { startConversation, type IntakeState } from "@/lib/intake/conversation";
import type { ChatReview } from "@/lib/intake/review";

/**
 * State threaded between the chat panel and its Server Action.
 *
 * Separate module because a `"use server"` file may only export async
 * functions. Third time this rule has shaped a file in this project.
 */
export interface ChatState {
  readonly intake: IntakeState;
  /**
   * What the published information says, computed once the conversation
   * reaches review and NOT before. Null while collecting, and null again if
   * the reporter changes the medicine or the reaction — the two answers a
   * reading is about.
   */
  readonly review: ChatReview | null;
  /**
   * Which path structured this report, carried from the turn that read the
   * narrative to the turn that files the case.
   *
   * It used to be computed and audited in the same turn, because those were
   * the same turn. They are not any more, and an audit line that could no
   * longer name the model behind a case would be a quiet loss of exactly the
   * traceability non-negotiable #9 asks for.
   */
  readonly extractedBy: string | null;
  readonly submitted: {
    readonly reference: string;
    readonly caseId: string;
  } | null;
  readonly error: string | null;
}

export function initialChatState(): ChatState {
  return {
    intake: startConversation(),
    review: null,
    extractedBy: null,
    submitted: null,
    error: null,
  };
}

/**
 * What the panel is asking the Server Action to do.
 *
 * Re-asking a question is NOT one of these, and the reason is HTML rather than
 * design: a submit button contributes exactly one name/value pair, and a
 * change needs two facts — that it is a change, and which slot. So the change
 * buttons post their slot under `change` and carry no intent at all, which the
 * action checks first. Encoding both into one value would work and would be a
 * small private format nobody could read off the form.
 */
export const CHAT_INTENTS = ["message", "submit"] as const;
export type ChatIntent = (typeof CHAT_INTENTS)[number];

export function parseIntent(raw: FormDataEntryValue | null): ChatIntent {
  return typeof raw === "string" &&
    (CHAT_INTENTS as readonly string[]).includes(raw)
    ? (raw as ChatIntent)
    : "message";
}

/**
 * The slots a form may hand to a fresh conversation.
 *
 * A deliberately narrow subset: the fields both intakes ask about, and nothing
 * a model produced. `seriousnessEvidence` in particular is character offsets
 * into a narrative that may since have been edited, and offsets into edited
 * text are worse than none.
 *
 * Parsed rather than cast, because this arrives as a form field and anybody
 * can post one.
 */
export const CarriedSlots = z.object({
  narrative: z.string().min(1).max(20_000).nullable().default(null),
  drug: z.string().min(1).max(200).nullable().default(null),
  age: z.number().int().nonnegative().max(130).nullable().default(null),
  sex: z.enum(["male", "female", "unknown"]).nullable().default(null),
  seriousness: z.array(SeriousnessCriterion).nullable().default(null),
  reporterName: z.string().min(1).max(200).nullable().default(null),
  reporterContact: z.string().min(1).max(200).nullable().default(null),
  dose: z.string().min(1).max(200).nullable().default(null),
});
export type CarriedSlots = z.output<typeof CarriedSlots>;

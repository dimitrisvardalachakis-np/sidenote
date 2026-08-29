import { z } from "zod";
import { SeriousnessCriterion } from "@/lib/schemas";
import { startConversation, type IntakeState } from "@/lib/intake/conversation";

/**
 * State threaded between the chat panel and its Server Action.
 *
 * Separate module because a `"use server"` file may only export async
 * functions. Third time this rule has shaped a file in this project.
 */
export interface ChatState {
  readonly intake: IntakeState;
  readonly submitted: {
    readonly reference: string;
    readonly caseId: string;
  } | null;
  readonly error: string | null;
}

export function initialChatState(): ChatState {
  return { intake: startConversation(), submitted: null, error: null };
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

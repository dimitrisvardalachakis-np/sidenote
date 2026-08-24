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

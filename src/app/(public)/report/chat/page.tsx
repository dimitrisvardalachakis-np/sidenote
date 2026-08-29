import type { Metadata } from "next";
import { Orientation } from "@/components/report/orientation";
import { ChatPanel } from "./chat-panel";

export const metadata: Metadata = {
  title: "Report a side effect — SideNote",
};

/**
 * Conversational intake.
 *
 * The honest framing is on the page, not buried in a comment: this is a
 * scripted intake, not a language model, and the passages it quotes are real.
 * Telling a member of the public they are talking to an AI when they are not
 * would be the kind of small lie that makes everything else suspect.
 */
export default function ChatIntakePage() {
  return (
    <main className="mx-auto w-full max-w-[70ch] px-4 py-8">
      <h1 className="text-title font-medium">Report by chat</h1>
      <p className="mt-2 text-prose text-slate">
        Describe what happened in your own words. We will ask for anything else
        we need, one question at a time.
      </p>

      <div className="mt-4">
        <Orientation />
      </div>

      <div className="mt-4 border border-rule p-3 rounded-soft">
        <p className="text-micro uppercase tracking-label text-slate">
          How this works
        </p>
        <p className="mt-1 text-meta">
          This is a scripted intake, not a chatbot — the questions are fixed and
          come from what a safety report legally requires. When you have
          finished, it searches the published information for that medicine and
          shows you the passage it found, if there is one. It only ever searches
          publicly available labels.
        </p>
      </div>

      <div className="mt-6">
        <ChatPanel />
      </div>
    </main>
  );
}

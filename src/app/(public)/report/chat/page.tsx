import type { Metadata } from "next";
import { Orientation } from "@/components/report/orientation";
import { ChatPanel } from "./chat-panel";
import { getTurnstileSiteKey } from "@/lib/protection/bot-gate";

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
export default async function ChatIntakePage() {
  // Server-read, so the widget and the gate cannot disagree about whether
  // Turnstile is on. See the note on /report's page.
  const siteKey = await getTurnstileSiteKey();

  return (
    <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 py-10">
      <h1 className="text-hero font-semibold">Report a side effect</h1>
      <p className="mt-2.5 text-prose text-slate">
        One question at a time. About five minutes, eight questions, and you can
        switch to the form at any point — your answers come with you.
      </p>

      <div className="mt-6">
        <Orientation />
      </div>

      <div className="mt-4 rounded-card border border-rule bg-surface p-5 shadow-card">
        <p className="font-mono text-micro uppercase tracking-label text-slate">
          How this works
        </p>
        <p className="mt-2 text-body text-slate">
          This is a scripted intake, not a chatbot — the questions are fixed and
          come from what a safety report legally requires. When you have
          finished, it searches the published information for that medicine and
          shows you the passage it found, if there is one. It only ever searches
          publicly available labels.
        </p>
      </div>

      <div className="mt-6">
        <ChatPanel siteKey={siteKey} />
      </div>
    </main>
  );
}

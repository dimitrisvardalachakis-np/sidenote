"use server";

import { submitReport, type SubmitOutcome } from "@/lib/report/submit";

/**
 * The form's submit path.
 *
 * Takes the draft object rather than FormData, because the wizard's answers
 * live in sessionStorage across five screens and never all exist as form
 * fields at once. The value is still validated here from scratch: whatever the
 * client believes, this parses it again.
 *
 * The Turnstile token rides alongside rather than inside the draft. It is not
 * part of the report — it says something about the sender, not about the
 * patient — and putting it in the draft would mean it got parsed by
 * ReportDraft, stored with the case, and eventually exported to a regulator.
 */
export async function submitReportAction(
  draft: unknown,
  botToken: string | null,
): Promise<SubmitOutcome> {
  return submitReport(draft, { kind: "browser", token: botToken });
}

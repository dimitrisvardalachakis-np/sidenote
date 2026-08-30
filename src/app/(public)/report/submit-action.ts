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
 * The Turnstile token is a second argument rather than a field on the draft
 * for the same reason: it is not part of the report, it is proof about the
 * sender, and a draft that carried one would be a draft that could be replayed
 * out of sessionStorage with a stale token attached.
 */
export async function submitReportAction(
  draft: unknown,
  botToken: string | null,
): Promise<SubmitOutcome> {
  return submitReport(draft, { kind: "browser", token: botToken });
}

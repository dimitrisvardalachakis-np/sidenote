"use server";

import { submitReport, type SubmitOutcome } from "@/lib/report/submit";

/**
 * The form's submit path.
 *
 * Takes the draft object rather than FormData, because the wizard's answers
 * live in sessionStorage across five screens and never all exist as form
 * fields at once. The value is still validated here from scratch: whatever the
 * client believes, this parses it again.
 */
export async function submitReportAction(
  draft: unknown,
): Promise<SubmitOutcome> {
  return submitReport(draft);
}

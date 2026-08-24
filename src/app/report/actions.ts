"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import {
  PublicReport,
  readReportFormValues,
  toFieldErrors,
} from "@/lib/schemas/public-report";
import { getReportStore } from "@/lib/store/report-store";
import type { ReportFormState } from "./form-state";

/**
 * Accept a public report.
 *
 * This runs the *same* PublicReport schema the client form runs. That is not
 * redundancy — the client check is a courtesy that saves a round trip, and
 * this one is the only check that actually protects anything. A client can be
 * a browser with JavaScript off, a script, or someone with curl, and the
 * server cannot tell the difference. Step 5's proof is exactly that: an
 * invalid payload posted straight at this action, past the form, is rejected
 * here.
 *
 * Anonymous by design — no session, no auth. That is what "public reporter,
 * no login" means, and it is why Cluster C puts Turnstile and a rate limit in
 * front of this rather than a password.
 */
export async function submitReport(
  _previous: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const values = readReportFormValues(formData);
  const parsed = PublicReport.safeParse(values);

  if (!parsed.success) {
    audit({
      actor: "public",
      action: "submit_report",
      target: "public_report_form",
      outcome: "rejected",
      detail: { issues: parsed.error.issues.length },
    });
    return { status: "invalid", errors: toFieldErrors(parsed.error), values };
  }

  let reference: string;
  try {
    const stored = await getReportStore().put(parsed.data);
    reference = stored.reference;
  } catch {
    audit({
      actor: "public",
      action: "submit_report",
      target: "public_report_form",
      outcome: "failure",
    });
    return {
      status: "error",
      errors: {
        form: "We could not save your report just then. Please try again — nothing was lost.",
      },
      values,
    };
  }

  audit({
    actor: "public",
    action: "submit_report",
    target: reference,
    outcome: "success",
    // Deliberately no personal data: a count, not a copy of the narrative.
    detail: { seriousFlags: parsed.data.seriousOutcomes.length },
  });

  // Outside the try/catch on purpose: redirect() signals by throwing, and
  // catching it here would turn a successful submission into a save error.
  redirect(`/report/thanks?ref=${encodeURIComponent(reference)}`);
}

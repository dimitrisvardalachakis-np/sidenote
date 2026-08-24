import {
  EMPTY_REPORT_VALUES,
  type PublicReportFieldErrors,
  type ReportFormValues,
} from "@/lib/schemas/public-report";

/**
 * The state useActionState threads between the form and the Server Action.
 *
 * This lives in its own module, not in actions.ts, for a reason worth
 * remembering: a `"use server"` file may only export async functions. Every
 * other export — a constant, an object, a class — is either rejected at build
 * time or silently arrives as `undefined` on the client. The initial state
 * was originally exported from actions.ts and came through as undefined,
 * which surfaced as `Object.keys(undefined)` during prerender rather than as
 * anything that named the actual rule.
 */
export interface ReportFormState {
  readonly status: "idle" | "invalid" | "error";
  readonly errors: PublicReportFieldErrors;
  /** Echoed back so a JS-less browser does not lose what was typed. */
  readonly values: ReportFormValues;
}

export const INITIAL_REPORT_STATE: ReportFormState = {
  status: "idle",
  errors: {},
  values: EMPTY_REPORT_VALUES,
};

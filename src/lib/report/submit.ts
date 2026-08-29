import "server-only";
import { audit } from "@/lib/audit";
import { getCaseStore } from "@/lib/store/case-store";
import {
  MISSING_MESSAGES,
  Report,
  ReportDraft,
  missingElements,
  trimDraft,
  type MissingElement,
} from "@/lib/schemas/report";
import { guardPublicSubmission } from "@/lib/protection/guard";
import { reportToCase } from "./to-case";

/**
 * The one place a public report becomes a case.
 *
 * Two transports call this: the Server Action behind the form, and the route
 * handler at /api/report. Both go through here so there is exactly one writer.
 * Two code paths that each create a case is how two subtly different cases
 * start appearing in the queue.
 */

export type SubmitOutcome =
  | {
      readonly status: "created";
      readonly reference: string;
      readonly caseId: string;
    }
  | {
      /** One or more of the four things a report needs is absent. */
      readonly status: "incomplete";
      readonly missing: readonly MissingElement[];
      readonly messages: readonly string[];
    }
  | {
      /** The shape is wrong: a malformed email, an impossible date. */
      readonly status: "malformed";
      readonly messages: readonly string[];
    }
  | {
      /** Turned away by the rate limit or the bot check. */
      readonly status: "blocked";
      readonly retryAfterSeconds: number;
      readonly message: string;
    }
  | { readonly status: "failed"; readonly message: string };

export async function submitReport(
  input: unknown,
  options: { readonly botToken?: string | null } = {},
): Promise<SubmitOutcome> {
  // Protection first, before any work is done on the input. An endpoint that
  // parses and stores before checking whether it should have is an endpoint
  // that can be made to do work for free.
  const guard = await guardPublicSubmission(options.botToken ?? null);
  if (!guard.allowed) {
    return {
      status: "blocked",
      retryAfterSeconds: guard.retryAfterSeconds,
      message: guard.message,
    };
  }

  // Parse the shape. This runs on the server no matter what the client
  // did or did not check, which is the only reason any of it is trustworthy.
  const shape = ReportDraft.safeParse(input);
  if (!shape.success) {
    audit({
      actor: "public",
      action: "submit_report",
      target: "report_form",
      outcome: "rejected",
      detail: { reason: "malformed", issues: shape.error.issues.length },
    });
    return {
      status: "malformed",
      messages: shape.error.issues.map((issue) => issue.message),
    };
  }

  /*
    Normalise once, here, now the reporter has finished typing.

    Trimming used to happen inside the field schemas, which meant it ran on
    every keystroke through the draft's round-trip and ate the spaces out of
    what somebody was still typing. This is the boundary it belongs at: the
    value is finished, so "Amoxil 500 " and "Amoxil 500" become one value.
  */
  const draft = trimDraft(shape.data);

  // Then the rule that all four are present. Reported separately from shape
  // errors because they are a different kind of problem with a different fix:
  // one is "that is not a valid email", the other is "we still need to know
  // who you are".
  const missing = missingElements(draft);
  if (missing.length > 0) {
    audit({
      actor: "public",
      action: "submit_report",
      target: "report_form",
      outcome: "rejected",
      detail: { reason: "incomplete", missing: missing.join(",") },
    });
    return {
      status: "incomplete",
      missing,
      messages: missing.map((element) => MISSING_MESSAGES[element]),
    };
  }

  // Belt and braces: parse through the gate schema too, so the rule cannot
  // drift between missingElements() and Report.
  const gated = Report.safeParse(draft);
  if (!gated.success) {
    return {
      status: "malformed",
      messages: gated.error.issues.map((issue) => issue.message),
    };
  }

  const now = new Date();
  const store = getCaseStore();

  try {
    const reference = await store.nextReference(now.getUTCFullYear());
    const record = reportToCase({
      draft: gated.data,
      reference,
      receivedAt: now.toISOString().slice(0, 10),
      now: now.toISOString(),
      ids: {
        caseId: crypto.randomUUID(),
        drugId: crypto.randomUUID(),
        reactionId: crypto.randomUUID(),
      },
    });
    await store.put(record);

    audit({
      actor: "public",
      action: "submit_report",
      target: reference,
      outcome: "success",
      // A count, never a copy of what the reporter wrote.
      detail: {
        seriousFlags: Object.values(record.reactions[0]?.seriousness ?? {}).filter(
          (flag) => flag !== null,
        ).length,
      },
    });

    return { status: "created", reference, caseId: record.id };
  } catch {
    audit({
      actor: "public",
      action: "submit_report",
      target: "report_form",
      outcome: "failure",
    });
    return {
      status: "failed",
      message:
        "We could not save your report just then. Nothing you typed has been lost. Please try again.",
    };
  }
}

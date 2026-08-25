import "server-only";
import { audit } from "@/lib/audit";
import { dispatch } from "@/lib/pipeline";
import { getCaseStore } from "@/lib/store/case-store";
import {
  MISSING_MESSAGES,
  Report,
  ReportDraft,
  missingElements,
  type MissingElement,
} from "@/lib/schemas/report";
import { guardPublicSubmission, type Caller } from "@/lib/protection/guard";
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
      /**
       * Which one. The transports need to tell them apart: "too many requests"
       * and "you do not look like a person" are different HTTP answers, and a
       * caller told 429 for a bot rejection will retry forever.
       */
      readonly reason: "rate_limited" | "bot";
      readonly retryAfterSeconds: number;
      readonly message: string;
    }
  | { readonly status: "failed"; readonly message: string };

/**
 * Who is submitting, and therefore whether a bot check even applies.
 *
 * REQUIRED, and a discriminated union rather than an optional token, for the
 * same reason `audience` is required on assessAgainstDocuments: a default here
 * is a decision nobody makes and everybody inherits.
 *
 * Turnstile is a browser widget. A partner system posting JSON cannot produce
 * a token, so if "no token" meant "rejected", the day somebody configured a
 * Turnstile secret would be the day this endpoint quietly stopped accepting
 * machine-submitted safety reports — with a 400-level answer that blames the
 * caller. Machine callers are still rate limited, and in a real deployment
 * would carry a credential; that is the seam, and it is named rather than
 * implied.
 */
export type SubmitCaller = Caller;

export async function submitReport(
  input: unknown,
  caller: SubmitCaller,
): Promise<SubmitOutcome> {
  // Protection first, before any work is done on the input. An endpoint that
  // parses and stores before checking whether it should have is an endpoint
  // that can be made to do work for free.
  const guard = await guardPublicSubmission(caller);
  if (!guard.allowed) {
    return {
      status: "blocked",
      reason: guard.reason,
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

  // Then the rule that all four are present. Reported separately from shape
  // errors because they are a different kind of problem with a different fix:
  // one is "that is not a valid email", the other is "we still need to know
  // who you are".
  const missing = missingElements(shape.data);
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
  const gated = Report.safeParse(shape.data);
  if (!gated.success) {
    return {
      status: "malformed",
      messages: gated.error.issues.map((issue) => issue.message),
    };
  }

  const now = new Date();
  const store = await getCaseStore();

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

    // Hand the case to the pipeline. Retrieval is not run here: a member of
    // the public pressing Send should not wait for a model, and non-negotiable
    // #5 says an AI failure must never block a human write — so the case is
    // already stored before this line and stays stored if it fails.
    await dispatch({ kind: "assess_case", caseId: record.id });

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

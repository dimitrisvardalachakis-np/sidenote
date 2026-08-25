import { submitReport } from "@/lib/report/submit";

/**
 * POST /api/report
 *
 * The same writer as the form, over plain HTTP.
 *
 * This exists because a Server Action always answers 200 and carries its
 * result in the response body, which is fine for a browser and useless for
 * anything else. A report can legitimately arrive from a partner system or a
 * gateway, and such a caller needs a real status code: 400 when the report is
 * missing one of the four things it needs, and a body naming which.
 *
 * Both routes go through submitReport(), so there is one place that creates a
 * case and one place the rules live.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { status: "malformed", messages: ["The request body was not JSON."] },
      { status: 400 },
    );
  }

  // A partner system proves itself with a credential, not a browser widget,
  // so the bot check does not apply on this path and says so explicitly. Were
  // this to pass a null token instead, configuring a Turnstile secret would
  // silently close this endpoint. The rate limit still applies.
  const outcome = await submitReport(body, { kind: "machine" });

  switch (outcome.status) {
    case "created":
      return Response.json(outcome, {
        status: 201,
        headers: { Location: `/case/${outcome.caseId}` },
      });
    case "incomplete":
    case "malformed":
      return Response.json(outcome, { status: 400 });
    case "blocked":
      // 429 means "come back later" and is only true of the rate limit. A bot
      // rejection is 403: retrying changes nothing, and a client told 429 will
      // retry forever.
      return outcome.reason === "rate_limited"
        ? Response.json(outcome, {
            status: 429,
            headers: { "Retry-After": String(outcome.retryAfterSeconds) },
          })
        : Response.json(outcome, { status: 403 });
    case "failed":
      return Response.json(outcome, { status: 500 });
  }
}

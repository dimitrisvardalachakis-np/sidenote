import "server-only";
import { ReviewerId } from "@/lib/schemas";

/**
 * Authentication, as a black box.
 *
 * There is exactly one authenticated role — Reviewer — and many humans share
 * it. That is not an oversight in the product; CLAUDE.md says two reviewers
 * opening the same case is the central conflict the app exists to resolve, so
 * the interesting arbitration is per-case claiming, not per-user identity.
 *
 * This stub exists so the rest of the app can be written against a real
 * shape now and have the mechanism swapped in later without touching a
 * single call site. Nothing outside this file knows how a session is
 * obtained. `server-only` makes importing it from a client component a build
 * error rather than a leaked secret.
 */

export interface Session {
  readonly reviewerId: ReviewerId;
  /** What the audit line records and the header shows. */
  readonly displayName: string;
}

/**
 * The signed-in reviewer, or null.
 *
 * Async on purpose even though the stub is synchronous: the real
 * implementation will read a cookie and verify it, and a function that
 * changes from sync to async later forces every caller to change with it.
 *
 * Set SIDENOTE_SIGNED_OUT=1 to make this return null. That is not a feature —
 * it is how the gate in the (app) layout gets tested without a login screen.
 */
export async function getSession(): Promise<Session | null> {
  if (process.env["SIDENOTE_SIGNED_OUT"] === "1") return null;

  return {
    reviewerId: ReviewerId.parse("reviewer-demo"),
    displayName: "Demo Reviewer",
  };
}

/**
 * The same, but refuses to continue without one.
 *
 * Callers that genuinely cannot proceed unauthenticated should use this, so
 * the null check is not repeated (and eventually forgotten) at every call
 * site. The (app) layout gate calls getSession directly because it wants to
 * redirect rather than throw.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session === null) {
    throw new Error("No reviewer session — this route requires the (app) gate");
  }
  return session;
}

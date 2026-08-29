import "server-only";
import { cookies } from "next/headers";
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
 *
 * There is no password, and there is not going to be one in this build. A
 * "session" here is which shared role you are currently wearing, held in a
 * cookie so the sign-out control in the rail is a real control rather than a
 * button that lies. Calling that authentication would be overselling it, so
 * the sign-in screen says what it actually is.
 */

/** Cleared on sign-in, set on sign-out. Absence means signed in. */
export const SESSION_COOKIE = "sidenote-session";
const SIGNED_OUT = "out";

/** Which shared reviewer identity you are currently wearing. */
export const REVIEWER_COOKIE = "sidenote-reviewer";

/**
 * The reviewers this demo can be.
 *
 * A stand-in for real accounts, and it earns its place: the screen a second
 * reviewer sees when a case is already taken is the interaction CLAUDE.md
 * calls the central conflict this app exists to resolve, and with exactly one
 * identity it is unreachable — you could seed a held case, but never be the
 * person who loses the race for it.
 *
 * `reviewer-demo` stays first and stays the default, so nothing changes for
 * anyone who never touches the switcher. The other two are the holders seeded
 * in `claim-store.ts`, so switching to one of them and back demonstrates both
 * sides of the same case.
 */
export const DEMO_REVIEWERS: readonly { id: string; displayName: string }[] = [
  { id: "reviewer-demo", displayName: "Demo Reviewer" },
  { id: "reviewer-ao", displayName: "A. Okonkwo" },
  { id: "reviewer-mb", displayName: "M. Bergström" },
];

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
 * it is how the gate in the (app) layout gets tested without a browser. The
 * cookie does the same thing for somebody who is actually clicking around.
 */
export async function getSession(): Promise<Session | null> {
  if (process.env["SIDENOTE_SIGNED_OUT"] === "1") return null;

  const jar = await cookies();
  if (jar.get(SESSION_COOKIE)?.value === SIGNED_OUT) return null;

  /*
    Only an id from the known list is accepted. A cookie is user-controlled
    input, and reading an arbitrary value out of it would let anyone name
    themselves anything on an audit line — which is the one place a name has to
    be worth something.
  */
  const wanted = jar.get(REVIEWER_COOKIE)?.value;
  const reviewer =
    DEMO_REVIEWERS.find((r) => r.id === wanted) ?? DEMO_REVIEWERS[0];
  if (reviewer === undefined) return null;

  return {
    reviewerId: ReviewerId.parse(reviewer.id),
    displayName: reviewer.displayName,
  };
}

/** Switch which shared identity this browser is wearing. */
export async function setReviewer(reviewerId: string): Promise<void> {
  if (!DEMO_REVIEWERS.some((r) => r.id === reviewerId)) return;
  const jar = await cookies();
  jar.set(REVIEWER_COOKIE, reviewerId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Adopt the shared reviewer role, or put it down.
 *
 * Separate from `getSession` because a read and a write are different powers
 * and a caller that only needs to know who you are should not be able to
 * change it by mistake.
 */
export async function setSignedOut(signedOut: boolean): Promise<void> {
  const jar = await cookies();
  if (signedOut) {
    jar.set(SESSION_COOKIE, SIGNED_OUT, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  } else {
    jar.delete(SESSION_COOKIE);
  }
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

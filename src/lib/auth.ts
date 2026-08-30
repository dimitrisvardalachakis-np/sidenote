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
 * There IS a password now, and it is checked. It is one shared password for
 * the whole build, not per-person authentication: the email says which of the
 * three shared identities you are wearing, and the password says you are
 * allowed to wear any of them. That is a real gate — you cannot reach the
 * queue without it — and it is emphatically not per-user credentials, so the
 * sign-in screen names which of the two it is rather than letting the presence
 * of a password field imply the stronger claim.
 *
 * A "session" is still which shared role you are wearing, held in a cookie, so
 * the sign-out control in the rail remains a real control rather than a button
 * that lies.
 */

/**
 * The session cookie. Its ABSENCE means signed out.
 *
 * It used to mean the opposite — the cookie was written on sign-out and
 * cleared on sign-in, so a browser that had never been here was signed in.
 * That was defensible while signing in was a single button with nothing to
 * type, and it is not defensible now: a password in front of a door that
 * stands open by default is decoration.
 *
 * The value is `<reviewerId>.<hmac>`. A bare marker would be forgeable by
 * anyone who can set a header, which would make "the queue is behind a
 * password" untrue in the one way that matters, and a bare id would let a
 * visitor name themselves anything on an audit line — the one place a name
 * has to be worth something.
 */
export const SESSION_COOKIE = "sidenote-session";

/**
 * The key the session cookie is signed with.
 *
 * Defaulted so a fresh clone runs, and overridable because a signing key
 * printed in a public repository signs nothing. SETUP.md says both, and says
 * which of the two a deployment needs.
 */
const DEFAULT_SESSION_SECRET = "sidenote-demo-session-key";

function sessionSecret(): string {
  const configured = process.env["SIDENOTE_SESSION_SECRET"];
  return configured === undefined || configured.length === 0
    ? DEFAULT_SESSION_SECRET
    : configured;
}

/** Every byte read, whatever the first mismatch. Same reason as checkPassword. */
function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

async function sign(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The reviewers this demo can be.
 *
 * A stand-in for real accounts, and it earns its place: the screen a second
 * reviewer sees when a case is already taken is the interaction CLAUDE.md
 * calls the central conflict this app exists to resolve, and with exactly one
 * identity it is unreachable — you could seed a held case, but never be the
 * person who loses the race for it.
 *
 * `reviewer-demo` stays first and stays the default. The other two are the
 * holders seeded in `claim-store.ts`, so signing in as one of them and back
 * demonstrates both sides of the same case.
 *
 * The addresses are on `.example`, which is reserved and can never resolve. An
 * identity list in a demo should not read as a list of real mailboxes.
 */
export const DEMO_REVIEWERS: readonly {
  id: string;
  displayName: string;
  email: string;
}[] = [
  {
    id: "reviewer-demo",
    displayName: "Demo Reviewer",
    email: "demo@sidenote.example",
  },
  {
    id: "reviewer-ao",
    displayName: "A. Okonkwo",
    email: "a.okonkwo@sidenote.example",
  },
  {
    id: "reviewer-mb",
    displayName: "M. Bergström",
    email: "m.bergstrom@sidenote.example",
  },
];

/**
 * The one shared password for this build.
 *
 * Overridable, so a deployment is not stuck with a value printed in a public
 * repository, and defaulted, so a fresh clone reaches the queue without a
 * setup step. SETUP.md documents both.
 */
const DEFAULT_PASSWORD = "sidenote-demo";

export function reviewerPassword(): string {
  const configured = process.env["SIDENOTE_REVIEWER_PASSWORD"];
  return configured === undefined || configured.length === 0
    ? DEFAULT_PASSWORD
    : configured;
}

/** Which shared identity an address names, or null. Case and space forgiving. */
export function findReviewerByEmail(
  email: string,
): { id: string; displayName: string; email: string } | null {
  const wanted = email.trim().toLowerCase();
  return DEMO_REVIEWERS.find((r) => r.email === wanted) ?? null;
}

/**
 * Is this the password, without leaking how nearly it was?
 *
 * Both sides are hashed first so the comparison is over two equal-length byte
 * arrays, then every byte is read regardless of where they first differ. A
 * plain `===` on strings returns the moment it finds a mismatch, and how long
 * that takes is a measurement of how much of the password was right.
 *
 * WebCrypto rather than `node:crypto`.timingSafeEqual, because CLAUDE.md puts
 * this on Workers eventually and that module is not there.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(reviewerPassword())),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

export interface Session {
  readonly reviewerId: ReviewerId;
  /** What the audit line records and the header shows. */
  readonly displayName: string;
}

/**
 * The signed-in reviewer, or null.
 *
 * Async on purpose: verifying a signature is asynchronous, and a function that
 * changes from sync to async later forces every caller to change with it. It
 * was already async for exactly this reason before there was anything to
 * verify.
 *
 * Set SIDENOTE_SIGNED_OUT=1 to force null. That is not a feature — it is how
 * the gate in the (app) layout gets tested without a browser.
 */
export async function getSession(): Promise<Session | null> {
  if (process.env["SIDENOTE_SIGNED_OUT"] === "1") return null;

  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw === undefined) return null;

  /*
    A cookie is user-controlled input, so nothing in it is believed until the
    signature over it checks out — and then only an id from the known list is
    accepted, because a valid signature over an unknown id would still be an
    unknown id.
  */
  const cut = raw.lastIndexOf(".");
  if (cut <= 0) return null;
  const reviewerId = raw.slice(0, cut);
  const presented = raw.slice(cut + 1);
  if (!constantTimeEquals(presented, await sign(reviewerId))) return null;

  const reviewer = DEMO_REVIEWERS.find((r) => r.id === reviewerId);
  if (reviewer === undefined) return null;

  return {
    reviewerId: ReviewerId.parse(reviewer.id),
    displayName: reviewer.displayName,
  };
}

/**
 * Adopt the shared reviewer role, or put it down.
 *
 * Separate from `getSession` because a read and a write are different powers
 * and a caller that only needs to know who you are should not be able to
 * change it by mistake. Only ever called after the password has been checked;
 * `session-actions.ts` is the one place that ordering exists.
 */
export async function startSession(reviewerId: string): Promise<void> {
  if (!DEMO_REVIEWERS.some((r) => r.id === reviewerId)) return;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, `${reviewerId}.${await sign(reviewerId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
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

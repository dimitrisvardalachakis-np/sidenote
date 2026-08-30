"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import {
  checkPassword,
  endSession,
  findReviewerByEmail,
  getSession,
  startSession,
} from "@/lib/auth";
import { clientIp } from "@/lib/protection/client-ip";
import { getSignInRateLimiter } from "@/lib/protection/rate-limit";
import type { SignInState } from "./signin-state";

/**
 * Putting the shared reviewer role on and taking it off.
 *
 * Outside a route group on purpose: both chromes need these. The sign-in
 * screen and the landing panel call one, the rail footer's `Sign out` calls
 * the other, and neither should have to reach into the other's tree.
 *
 * There is one shared password, and it is checked here. The email decides
 * which of the three shared identities you are wearing; the password decides
 * whether you may wear one at all. What this is NOT is per-person
 * authentication, and the screen says so — a password field that implies
 * per-user credentials would be a claim about security that is not true.
 *
 * The identity switcher that used to live in the rail footer is gone with
 * this change, and had to be: it was a Server Action that changed who you
 * were with no credential, so leaving it in place would have left the door it
 * opened next to the one now being locked.
 */

export async function signIn(
  _state: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = (formData.get("email") ?? "").toString();
  const password = (formData.get("password") ?? "").toString();

  /*
    The ceiling first, before any work that depends on the credentials. A
    limiter consulted after the check is a limiter that still lets every guess
    be measured.
  */
  const ip = await clientIp();
  const decision = await (await getSignInRateLimiter()).check(`sign_in:${ip}`);
  if (!decision.allowed) {
    audit({
      actor: "public",
      action: "rate_limited",
      target: "sign_in",
      outcome: "rejected",
      detail: { retryAfterSeconds: decision.retryAfterSeconds },
    });
    const minutes = Math.ceil(decision.retryAfterSeconds / 60);
    return {
      status: "rejected",
      error:
        minutes <= 1
          ? "Too many attempts. Wait a minute and try again."
          : `Too many attempts. Try again in about ${minutes} minutes.`,
    };
  }

  const reviewer = findReviewerByEmail(email);
  const correct = await checkPassword(password);

  /*
    BOTH halves are evaluated before either is acted on, and one message
    covers both failures. Saying "no such address" would turn this form into a
    way to enumerate who works here, and the password is checked either way so
    an unknown address does not return faster than a known one.
  */
  if (reviewer === null || !correct) {
    audit({
      actor: "public",
      action: "sign_in",
      target: "reviewer_role",
      outcome: "rejected",
      // The address, never the password, and only once it is known to be one
      // of ours — echoing an arbitrary submitted string into the audit log is
      // how a log becomes an injection surface.
      detail: { email: reviewer?.email ?? "unrecognised" },
    });
    return {
      status: "rejected",
      error: "That email and password do not match. Check both and try again.",
    };
  }

  await startSession(reviewer.id);
  audit({
    actor: reviewer.id,
    action: "sign_in",
    target: "reviewer_role",
    outcome: "success",
    detail: { mechanism: "shared demo password, one identity per address" },
  });
  redirect("/queue");
}

export async function signOut(): Promise<void> {
  // Read before clearing, so the line records who left rather than "unknown".
  const session = await getSession();
  await endSession();
  audit({
    actor: session?.reviewerId ?? "unknown",
    action: "sign_out",
    target: "reviewer_role",
    outcome: "success",
  });
  redirect("/");
}

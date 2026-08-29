"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { getSession, setReviewer, setSignedOut } from "@/lib/auth";

/**
 * Putting the shared reviewer role on and taking it off.
 *
 * Outside a route group on purpose: both chromes need these. The public
 * header's `Reviewer sign-in →` calls one, the rail footer's `Sign out` calls
 * the other, and neither should have to reach into the other's tree.
 *
 * There is no password. This build has one shared reviewer role and says so
 * on the sign-in control itself, because a control labelled "sign in" that
 * authenticates nobody is a claim about security that is not true.
 */

export async function signIn(): Promise<void> {
  await setSignedOut(false);
  audit({
    actor: "public",
    action: "sign_in",
    target: "reviewer_role",
    outcome: "success",
    detail: { mechanism: "shared demo role, no credential" },
  });
  redirect("/queue");
}

export async function signOut(): Promise<void> {
  // Read before clearing, so the line records who left rather than "unknown".
  const session = await getSession();
  await setSignedOut(true);
  audit({
    actor: session?.reviewerId ?? "unknown",
    action: "sign_out",
    target: "reviewer_role",
    outcome: "success",
  });
  redirect("/");
}


/**
 * Become a different reviewer.
 *
 * Standing in for real accounts so the claim conflict can be demonstrated from
 * both sides. It is audited like any other identity change, because an
 * unlogged way to change who you are would undermine every other line.
 */
export async function switchReviewer(formData: FormData): Promise<void> {
  const previous = await getSession();
  const wanted = (formData.get("reviewerId") ?? "").toString();
  await setReviewer(wanted);
  audit({
    actor: previous?.reviewerId ?? "unknown",
    action: "switch_reviewer",
    target: "reviewer_role",
    outcome: "success",
    detail: { to: wanted, mechanism: "demo identity switcher, no credential" },
  });
  revalidatePath("/", "layout");
}

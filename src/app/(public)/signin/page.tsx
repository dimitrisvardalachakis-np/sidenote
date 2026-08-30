import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/signin-form";
import { DEMO_REVIEWERS, getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in — SideNote",
};

/**
 * The reviewer's door.
 *
 * It used to be a button on the landing page that signed you straight in, and
 * the auth gate redirected anyone unauthenticated back to that landing page —
 * so "sign in" was a single click and there was no screen where a credential
 * could be asked for. There is one now, it is under `(public)` so it is
 * reachable while signed out, and the gate sends people here.
 *
 * Already signed in? Go to the queue. A sign-in screen shown to somebody who
 * is signed in is a screen offering to solve a problem they do not have.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if ((await getSession()) !== null) redirect("/queue");

  return (
    <main className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col justify-center px-4 py-12">
      <div className="rounded-card border border-rule bg-surface p-6 shadow-float sm:p-8">
        <p className="font-mono text-micro uppercase tracking-label text-steady">
          Reviewer access
        </p>
        <h1 className="mt-2 text-h1 font-semibold">Sign in to the queue</h1>
        <p className="mt-2.5 text-body text-slate">
          Cases are confidential. Nothing from the queue is visible until you
          are signed in — access is granted by your safety lead.
        </p>

        <div className="mt-6">
          <SignInForm submitLabel="Sign in" identities={DEMO_REVIEWERS} />
        </div>
      </div>
    </main>
  );
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { signOut, switchReviewer } from "@/app/session-actions";
import { DemoBanner } from "@/components/demo-banner";
import { ReviewerRail } from "@/components/reviewer-rail";
import { DEMO_REVIEWERS, getSession } from "@/lib/auth";

/**
 * The single authentication gate, and the reviewer chrome.
 *
 * Every reviewer route lives under this layout, so there is exactly one place
 * where "are you signed in" is asked. Putting the check in each page would
 * mean a new page is unprotected by default, which is the wrong default for
 * screens showing confidential company documents.
 *
 * A route group `(app)` rather than a path segment: the gate is a fact about
 * these routes, not something a reviewer should see in the URL. The queue is
 * at /queue, not /app/queue.
 *
 * The rail lives here rather than in the root layout, which is the whole of
 * the navigation change. A reporter is under `(public)` and never renders it;
 * the signed-in strip it used to need has folded into the rail's footer,
 * where the reviewer's identity sits beside the control that ends it.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect("/");

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <ReviewerRail
        displayName={session.displayName}
        reviewerId={session.reviewerId}
        reviewers={DEMO_REVIEWERS}
        signOut={signOut}
        switchReviewer={switchReviewer}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

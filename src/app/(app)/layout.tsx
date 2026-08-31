import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/app/session-actions";
import { ReviewerRail } from "@/components/reviewer-rail";
import { getSession } from "@/lib/auth";
import { loadQueue } from "@/lib/queue/entries";
import { buildRows } from "@/lib/queue/view";
import { countAll } from "@/lib/queue/filter";
import { getCaseCoordination } from "@/lib/coordinator";
import type { IsoDate } from "@/lib/schemas";

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
 * Unauthenticated goes to `/signin`, not to `/`. It used to land on the front
 * door, which had no field to type a credential into — so the gate bounced you
 * to a page that could not resolve the reason you were bounced.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect("/signin");

  /*
    The rail's count line, computed with the same functions the queue page
    uses rather than with a second tally. `countAll` is the one implementation
    of what "overdue" means, and a sidebar quietly disagreeing with the screen
    beside it about how many cases are late is worse than a sidebar with no
    number at all.
  */
  const today: IsoDate = new Date().toISOString().slice(0, 10);
  const rows = buildRows({
    entries: await loadQueue(today),
    today,
    claims: await (await getCaseCoordination()).held(),
    // Null, not this reviewer's real last visit: reading it here would stamp
    // it on every page load, and the queue's "arrived since your last visit"
    // dot would be spent before the queue rendered.
    lastVisit: null,
  });
  const counts = countAll(rows, { reviewerId: session.reviewerId });

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <ReviewerRail
        displayName={session.displayName}
        signOut={signOut}
        caseCount={rows.length}
        overdueCount={counts.overdue}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

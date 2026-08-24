import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/**
 * The single authentication gate.
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
 * The navigation that used to live here has moved to the persistent sidebar,
 * so this is now only the gate and the signed-in strip.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect("/");

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-rule px-4 py-1.5">
        <p className="text-micro uppercase tracking-label text-slate">
          Reviewer · signed in as <span className="text-ink">{session.displayName}</span>
        </p>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

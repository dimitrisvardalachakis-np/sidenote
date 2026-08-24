import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/**
 * The single authentication gate.
 *
 * Every reviewer route lives under this layout, so there is exactly one place
 * where "are you signed in" is asked. Putting the check in each page would
 * mean a new page is unprotected by default, which is the wrong default for
 * the screens that show confidential company documents.
 *
 * A route group `(app)` rather than a path segment: the gate is a fact about
 * these routes, not something the reviewer should have to see in the URL.
 * The queue is at /queue, not /app/queue.
 *
 * Redirecting rather than rendering a sign-in form is deliberate — there is no
 * login system this session, and a fake one would be the kind of thing that
 * quietly survives into a later cluster.
 */
/**
 * The gate must run per request, not once at build time.
 *
 * The stub reads an env var, which is not a dynamic API, so Next happily
 * prerendered /queue and /library as static — meaning the session check
 * happened during `next build` and every visitor got the same cached answer.
 * That is fine for a constant stub and catastrophic for a real one.
 *
 * This line becomes unnecessary the moment getSession() reads cookies(),
 * because that opts the route into dynamic rendering on its own. It is here
 * so the behaviour is right now rather than right later, and so nobody
 * discovers the difference by shipping it.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect("/");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2">
          <nav aria-label="Reviewer" className="flex items-center gap-4">
            <Link href="/queue" className="text-base hover:text-steady">
              Queue
            </Link>
            <Link href="/library" className="text-base hover:text-steady">
              Library
            </Link>
          </nav>
          <p className="text-meta text-slate">
            Signed in as{" "}
            <span className="text-ink">{session.displayName}</span>
          </p>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

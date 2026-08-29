import type { ReactNode } from "react";
import { PublicHeader } from "@/components/public-header";

/**
 * The public chrome: `/` and `/report/*`.
 *
 * A route group rather than a path segment, so the URLs a reporter sees are
 * unchanged — this is a fact about which chrome the route wears, not something
 * that belongs in an address a patient might be reading off a letter.
 *
 * No authentication gate here, deliberately. These routes are reachable by
 * anyone with the link and are protected by Turnstile and a rate limit at the
 * point of submission instead, because requiring an account to report a side
 * effect is how side effects go unreported.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <PublicHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

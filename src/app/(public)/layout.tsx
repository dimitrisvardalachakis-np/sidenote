import type { ReactNode } from "react";
import { DemoNotice } from "@/components/demo-banner";
import { PublicHeader } from "@/components/public-header";

/**
 * The public chrome: `/`, `/signin` and `/report/*`.
 *
 * A route group rather than a path segment, so the URLs a reporter sees are
 * unchanged — this is a fact about which chrome the route wears, not something
 * that belongs in an address a patient might be reading off a letter.
 *
 * No authentication gate here, deliberately. These routes are reachable by
 * anyone with the link and are protected by Turnstile and a rate limit at the
 * point of submission instead, because requiring an account to report a side
 * effect is how side effects go unreported. `/signin` lives here for the same
 * reason in reverse: a sign-in screen behind the sign-in gate is unreachable.
 *
 * The footer carries the rest of non-negotiable #10. The header's pill says
 * "Training demo"; this says what that means. Splitting them is what let the
 * top of the page stay calm without the claim getting shorter.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <PublicHeader />
      <div className="flex flex-1 flex-col">{children}</div>
      <footer
        aria-label="Environment notice"
        className="border-t border-rule px-4 py-4"
      >
        <DemoNotice className="mx-auto w-full max-w-[76rem]" />
      </footer>
    </div>
  );
}

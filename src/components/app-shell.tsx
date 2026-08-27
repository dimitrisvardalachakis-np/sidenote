import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

/**
 * The frame every page sits in: persistent rail on the left, banner and
 * content on the right.
 *
 * The banner stays in the content column rather than spanning the whole
 * window, so it scrolls with what it is describing and cannot be mistaken for
 * part of the navigation. It is still on every page, which is what
 * non-negotiable #10 asks for.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-rule">
          <p className="px-4 py-2 text-micro uppercase tracking-label text-slate">
            Training demo · synthetic and public data · not a validated system
          </p>
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { isStorageDurable } from "@/lib/store/backing";

/**
 * The frame every page sits in: persistent rail on the left, banner and
 * content on the right.
 *
 * The banner stays in the content column rather than spanning the whole
 * window, so it scrolls with what it is describing and cannot be mistaken for
 * part of the navigation. It is still on every page, which is what
 * non-negotiable #7 asks for.
 *
 * Cluster C added the third clause. On Workers there is no durable store bound
 * yet — see lib/store/backing.ts — so a case that is saved may not be there
 * later. A banner whose whole job is to say "do not trust this like a real
 * system" and which stays quiet about THAT is telling half of the one truth it
 * was put there to tell. It is --slate like the rest: red means expedited or
 * overdue, nothing else, ever.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const durable = isStorageDurable();

  return (
    <div className="flex min-h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-rule">
          <p className="px-4 py-2 text-micro uppercase tracking-label text-slate">
            Training demo · synthetic and public data · not a validated system
            {durable ? null : " · storage is temporary here, saved work can be lost"}
          </p>
        </div>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

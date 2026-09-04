import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { loadQueue } from "@/lib/queue/entries";
import { lookupCaseReference } from "@/lib/queue/reference";
import type { IsoDate } from "@/lib/schemas";
import { todayInAthens } from "@/lib/format/datetime";

/**
 * "Look at SN-2026-000104" — the jump box in the reviewer rail posts here.
 *
 * A route handler rather than client-side resolution, for two reasons. The
 * rail would otherwise need the whole queue as props on every reviewer page
 * just to answer a question nobody has asked yet, and a plain GET form works
 * with no JavaScript at all — the keyboard shortcut in `jump-to-case.tsx` is
 * an enhancement on top of a form that already functions without it.
 *
 * `/goto` rather than `/case/find`: a static segment under `/case` would
 * shadow `/case/[id]` for any case whose id happened to be "find". No case id
 * is, and relying on that is how a route conflict gets discovered in
 * production rather than in a plan.
 *
 * A layout does not run for a route handler, so the `(app)` gate does not
 * apply here and the session is required explicitly.
 */
export async function GET(request: NextRequest) {
  await requireSession();

  const typed = request.nextUrl.searchParams.get("ref") ?? "";
  const today: IsoDate = todayInAthens();
  const entries = await loadQueue(today);

  const result = lookupCaseReference(
    typed,
    entries.map((e) => ({ id: e.record.id, reference: e.record.reference })),
  );

  if (result.kind === "found") {
    return NextResponse.redirect(new URL(`/case/${result.caseId}`, request.url));
  }

  /*
    Both failures go back to the queue carrying what was typed, so the reviewer
    sees their own input beside the explanation rather than an empty box and a
    shrug. Ambiguity is reported as ambiguity — "104 matches two cases" is a
    different fact from "no case called 104", and a reviewer who is told the
    second when the first is true will stop trusting the box.
  */
  const back = new URL("/queue", request.url);
  back.searchParams.set("ref", typed);
  back.searchParams.set("jump", result.kind);
  return NextResponse.redirect(back);
}

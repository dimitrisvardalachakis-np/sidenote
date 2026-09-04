import { claimExpiryFrom, type CaseClaim } from "./claim";
import type { IsoDateTime } from "@/lib/schemas";

/**
 * Cases that arrive already held by somebody else.
 *
 * Not decoration. The screen a second reviewer sees when a case is taken is
 * the one CLAUDE.md calls the central conflict, and without seeded holders it
 * would be unreachable in a demo where only one identity exists — you would
 * have to take a case and then become somebody else to see it. These make it
 * visible the moment the queue loads.
 *
 * A runtime leaf on purpose: `CaseCoordinator` imports this, and so does the
 * Next bundle through `getCaseCoordination()`. A value import of anything
 * Cloudflare-shaped here would drag `cloudflare:workers` into the RSC graph,
 * and `server-only` would stop the Durable Object importing it at all.
 */

/*
  THE SEEDED WINDOW ROLLS, AND THAT IS NOT A CHEAT.

  Claims lapse (see claim.ts), and these two exist so that the screen a second
  reviewer sees when a case is taken — the one CLAUDE.md calls the central
  conflict — is reachable the moment the queue loads. A fixed `expiresAt`
  written here would lapse the first time the demo ran on a later day, and the
  most important screen in the app would quietly stop being reachable, in a way
  that looks like the feature working rather than a stale fixture.

  So the seeds are held from a fixed past instant and expire a window from NOW.
  `heldSince` stays honest — the queue prints "held for 2 days" and means it —
  while the lapse never fires on a fixture nobody can release.

  It is also why these are not two rows in migration 0003. A row carries a
  fixed `expires_at`, which is exactly the thing that goes stale; computing it
  per read is the whole point.
*/
/*
  ONE, where there were two. The second seeded holder was on SN-2026-000108,
  which left with the fixture cut — a claim on a case that no longer exists is
  invisible rather than wrong, which is why it needed removing by hand. The
  survivor is the contested write the demo walks through.
*/
const SEEDED: readonly (readonly [string, Omit<CaseClaim, "expiresAt">])[] = [
  [
    "00000002-0000-4000-8000-000000000105",
    {
      reviewerId: "reviewer-ao",
      displayName: "A. Okonkwo",
      heldSince: "2026-08-29T09:12:00Z" as IsoDateTime,
    },
  ],
];

/** The ids that have a fixture holder, for a reader folding them into a list. */
export const SEEDED_CASE_IDS: readonly string[] = SEEDED.map(([id]) => id);

/**
 * The fixture holder for a case, or null.
 *
 * `now` is passed in rather than read, like every other dated function in this
 * codebase — and here it matters more than usual, because the Durable Object
 * calls it with the same `now` it arbitrates the rest of the turn against.
 */
export function seededHolder(
  caseId: string,
  now: IsoDateTime,
): CaseClaim | null {
  const found = SEEDED.find(([id]) => id === caseId);
  if (found === undefined) return null;
  return { ...found[1], expiresAt: claimExpiryFrom(now) };
}

import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CaseClaim } from "@/lib/case/claim";

/**
 * Who holds which case.
 *
 * A separate store rather than a field on `Case`, for one practical reason:
 * most of the queue is seeded fixtures rebuilt from code on every request, so
 * a claim written onto a `Case` would be discarded the moment the page
 * re-rendered. Keeping claims beside the cases means a fixture can be claimed,
 * released and re-claimed like any other case, which is what makes the
 * conflict demonstrable at all.
 *
 * Same seam as the other stores: an interface, a local-file implementation for
 * this session, one line for Cluster D to point at the Durable Object.
 *
 * THE HONEST LIMIT. `claim` reads and then writes, and nothing serialises the
 * two. Two requests arriving in the same millisecond can both see null and
 * both write. That window is what `idFromName(caseId)` closes — a Durable
 * Object is single-threaded per id, so the read-then-write becomes atomic
 * without a lock. Until then this is a demonstration of the interaction, not a
 * guarantee about it, and it is written down here rather than implied to be
 * safe.
 */

const StoredClaim = z.object({
  reviewerId: z.string().min(1),
  displayName: z.string().min(1),
  heldSince: z.string().min(1),
});

export interface ClaimStore {
  get(caseId: string): Promise<CaseClaim | null>;
  put(caseId: string, claim: CaseClaim): Promise<void>;
  clear(caseId: string): Promise<void>;
  /** Every claim currently held, so the queue can filter on Mine / Unclaimed. */
  all(): Promise<ReadonlyMap<string, CaseClaim>>;
}

const DIR = join(process.cwd(), ".data", "claims");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cases that arrive already held by somebody else.
 *
 * Not decoration. The screen a second reviewer sees when a case is taken is
 * the one CLAUDE.md calls the central conflict, and without seeded holders it
 * would be unreachable in a demo where only one identity exists — you would
 * have to take a case and then become somebody else to see it. These make it
 * visible the moment the queue loads.
 *
 * Overridden by anything in `.data/claims`, so claiming and releasing behave
 * normally on top of them.
 */
const SEEDED_HOLDERS: Readonly<Record<string, CaseClaim>> = {
  "00000002-0000-4000-8000-000000000105": {
    reviewerId: "reviewer-ao",
    displayName: "A. Okonkwo",
    heldSince: "2026-08-29T09:12:00Z",
  },
  "00000002-0000-4000-8000-000000000108": {
    reviewerId: "reviewer-mb",
    displayName: "M. Bergström",
    heldSince: "2026-08-29T11:47:00Z",
  },
};

class LocalFileClaimStore implements ClaimStore {
  async get(caseId: string): Promise<CaseClaim | null> {
    if (!UUID.test(caseId)) return null;
    const released = await this.isReleased(caseId);
    try {
      const raw = await readFile(join(DIR, `${caseId}.json`), "utf8");
      const parsed = StoredClaim.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // No stored claim. Fall through to the seed.
    }
    if (released) return null;
    return SEEDED_HOLDERS[caseId] ?? null;
  }

  async put(caseId: string, claim: CaseClaim): Promise<void> {
    if (!UUID.test(caseId)) return;
    await mkdir(DIR, { recursive: true });
    await rm(join(DIR, `${caseId}.released`), { force: true });
    await writeFile(
      join(DIR, `${caseId}.json`),
      JSON.stringify(claim, null, 2),
      "utf8",
    );
  }

  /*
    Releasing a SEEDED claim needs a tombstone, not just a deleted file.
    Without one, removing the stored claim would fall through to the seed and
    the case would spring back to being held — a release button that visibly
    does nothing, which is worse than not offering one.
  */
  async clear(caseId: string): Promise<void> {
    if (!UUID.test(caseId)) return;
    await mkdir(DIR, { recursive: true });
    await rm(join(DIR, `${caseId}.json`), { force: true });
    if (SEEDED_HOLDERS[caseId] !== undefined) {
      await writeFile(join(DIR, `${caseId}.released`), "", "utf8");
    }
  }

  async all(): Promise<ReadonlyMap<string, CaseClaim>> {
    const claims = new Map<string, CaseClaim>();
    for (const [caseId, claim] of Object.entries(SEEDED_HOLDERS)) {
      if (!(await this.isReleased(caseId))) claims.set(caseId, claim);
    }
    try {
      const { readdir } = await import("node:fs/promises");
      for (const name of await readdir(DIR)) {
        if (!name.endsWith(".json")) continue;
        const caseId = name.slice(0, -".json".length);
        const claim = await this.get(caseId);
        if (claim !== null) claims.set(caseId, claim);
      }
    } catch {
      // No directory yet: the seeded holders are the whole answer.
    }
    return claims;
  }

  private async isReleased(caseId: string): Promise<boolean> {
    try {
      await readFile(join(DIR, `${caseId}.released`), "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

let store: ClaimStore | null = null;

export function getClaimStore(): ClaimStore {
  store ??= new LocalFileClaimStore();
  return store;
}

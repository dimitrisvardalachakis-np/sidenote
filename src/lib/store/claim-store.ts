import "server-only";
import { z } from "zod";
import { claimExpiryFrom, type CaseClaim } from "@/lib/case/claim";
import type { IsoDateTime } from "@/lib/schemas";
import {
  announceEphemeralWrite,
  dataPath,
  ephemeralSingleton,
  nodeFs,
  nodePath,
  storageBacking,
} from "./backing";

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
 * NOT WHAT THE APP TALKS TO ANY MORE. `getCaseCoordination()` is, and behind it
 * is `CaseCoordinator` — one Durable Object per case, addressed
 * `idFromName(caseId)`, whose methods cannot run concurrently.
 *
 * This file used to carry a paragraph admitting that `claim` reads and then
 * writes with nothing serialising the two, so two requests in the same
 * millisecond could both see null and both write. That is the window the
 * Durable Object closed, and the paragraph is kept here in the past tense
 * because it is the reason the coordinator exists.
 *
 * What survives is the seeded holders and the local/ephemeral persistence the
 * in-process stand-in leans on, so `next dev` without a binding still has
 * somewhere to put a claim that outlives a page render.
 */

const StoredClaim = z.object({
  reviewerId: z.string().min(1),
  displayName: z.string().min(1),
  heldSince: z.string().min(1),
  expiresAt: z.string().min(1),
});

export interface ClaimStore {
  get(caseId: string): Promise<CaseClaim | null>;
  put(caseId: string, claim: CaseClaim): Promise<void>;
  clear(caseId: string): Promise<void>;
  /** Every claim currently held, so the queue can filter on Mine / Unclaimed. */
  all(): Promise<ReadonlyMap<string, CaseClaim>>;
}

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
/*
  THE SEEDED WINDOW ROLLS, AND THAT IS NOT A CHEAT.

  Claims lapse now (see case/claim.ts), and these two exist so that the screen
  a second reviewer sees when a case is taken — the one CLAUDE.md calls the
  central conflict — is reachable the moment the queue loads. A fixed
  `expiresAt` written here would lapse the first time the demo ran on a later
  day, and the most important screen in the app would quietly stop being
  reachable, in a way that looks like the feature working rather than a stale
  fixture.

  So the seeds are held from a fixed past instant and expire a window from
  NOW. `heldSince` stays honest — the queue prints "held for 2 days" and means
  it — while the lapse never fires on a fixture nobody can release.
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
  [
    "00000002-0000-4000-8000-000000000108",
    {
      reviewerId: "reviewer-mb",
      displayName: "M. Bergström",
      heldSince: "2026-08-29T11:47:00Z" as IsoDateTime,
    },
  ],
];

function seededHolder(caseId: string): CaseClaim | null {
  const found = SEEDED.find(([id]) => id === caseId);
  if (found === undefined) return null;
  return {
    ...found[1],
    expiresAt: claimExpiryFrom(new Date().toISOString() as IsoDateTime),
  };
}

class LocalFileClaimStore implements ClaimStore {
  async get(caseId: string): Promise<CaseClaim | null> {
    if (!UUID.test(caseId)) return null;
    const { readFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("claims");
    const released = await this.#isReleased(caseId);
    try {
      const raw = await readFile(join(dir, `${caseId}.json`), "utf8");
      const parsed = StoredClaim.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data as CaseClaim;
    } catch {
      // No stored claim. Fall through to the seed.
    }
    if (released) return null;
    return seededHolder(caseId);
  }

  async put(caseId: string, claim: CaseClaim): Promise<void> {
    if (!UUID.test(caseId)) return;
    const { mkdir, rm, writeFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("claims");
    await mkdir(dir, { recursive: true });
    await rm(join(dir, `${caseId}.released`), { force: true });
    await writeFile(
      join(dir, `${caseId}.json`),
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
    const { mkdir, rm, writeFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("claims");
    await mkdir(dir, { recursive: true });
    await rm(join(dir, `${caseId}.json`), { force: true });
    if (seededHolder(caseId) !== null) {
      await writeFile(join(dir, `${caseId}.released`), "", "utf8");
    }
  }

  async all(): Promise<ReadonlyMap<string, CaseClaim>> {
    const claims = new Map<string, CaseClaim>();
    for (const [caseId] of SEEDED) {
      const seed = seededHolder(caseId);
      if (seed !== null && !(await this.#isReleased(caseId))) {
        claims.set(caseId, seed);
      }
    }
    try {
      const { readdir } = await nodeFs();
      for (const name of await readdir(await dataPath("claims"))) {
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

  async #isReleased(caseId: string): Promise<boolean> {
    const { readFile } = await nodeFs();
    const { join } = await nodePath();
    try {
      await readFile(
        join(await dataPath("claims"), `${caseId}.released`),
        "utf8",
      );
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Per-isolate claims, for a Worker with no disk and no Durable Object.
 *
 * The seeds still apply, so the contested-claim screen is reachable even here;
 * what is lost is that a claim does not outlive the isolate, which is exactly
 * what the ephemeral audit line says.
 */
class EphemeralClaimStore implements ClaimStore {
  readonly #claims = new Map<string, CaseClaim>();
  readonly #released = new Set<string>();

  async get(caseId: string): Promise<CaseClaim | null> {
    const held = this.#claims.get(caseId);
    if (held !== undefined) return held;
    if (this.#released.has(caseId)) return null;
    return seededHolder(caseId);
  }

  async put(caseId: string, claim: CaseClaim): Promise<void> {
    announceEphemeralWrite("claim_store", caseId);
    this.#released.delete(caseId);
    this.#claims.set(caseId, claim);
  }

  async clear(caseId: string): Promise<void> {
    announceEphemeralWrite("claim_store", caseId);
    this.#claims.delete(caseId);
    this.#released.add(caseId);
  }

  async all(): Promise<ReadonlyMap<string, CaseClaim>> {
    const claims = new Map<string, CaseClaim>();
    for (const [caseId] of SEEDED) {
      const seed = seededHolder(caseId);
      if (seed !== null && !this.#released.has(caseId)) claims.set(caseId, seed);
    }
    for (const [caseId, claim] of this.#claims) claims.set(caseId, claim);
    return claims;
  }
}

const localStore: ClaimStore = new LocalFileClaimStore();

/**
 * Where a claim is kept when the Durable Object is not the one keeping it.
 *
 * There is no D1 implementation here, and that is the point rather than an
 * omission: a claim's durable home is `CaseCoordinator`, because the thing
 * that makes it correct is serialisation and not persistence. A D1 row would
 * reintroduce the read-then-write race this store's own header describes.
 * So this is the local/degraded backing only, and `getCaseCoordination()` is
 * what the app actually talks to.
 */
export async function getClaimStore(): Promise<ClaimStore> {
  if ((await storageBacking()) !== "ephemeral") return localStore;
  // Anchored to the isolate, not the module: Next instantiates this module
  // once per bundle, so a plain `const` would give the queue page and the case
  // page separate Maps. See backing.ts.
  return ephemeralSingleton("claim_store", () => new EphemeralClaimStore());
}

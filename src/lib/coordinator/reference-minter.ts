import { DurableObject } from "cloudflare:workers";
import { CaseReference } from "@/lib/schemas";

/**
 * Mints the public case reference, one at a time.
 *
 * THIS FIXES A BUG THE CODE HAS BEEN CARRYING SINCE CLUSTER A STEP 5, WHERE IT
 * WAS WRITTEN DOWN RATHER THAN FIXED:
 *
 *   "Reference generation counts files, which is wrong under concurrency: two
 *    submissions can mint the same reference. Named in the code as a Durable
 *    Object job for Cluster D rather than left to be discovered."
 *
 * Every implementation so far has been count-then-add — count the files, or
 * count the rows, and use N+1. Two reports submitted in the same second both
 * count N and both mint N+1, and two different patients are now holding the
 * same reference number. That number is what a frightened person is told to
 * quote on the phone, and what the regulator uses to identify the report.
 *
 * COUNT-THEN-ADD CANNOT BE FIXED BY COUNTING BETTER. `SELECT MAX(reference)`
 * has exactly the same race, one row further along. What is needed is a single
 * place where the increment happens, and that is what a Durable Object is:
 * one instance, `idFromName("case-reference")`, and the platform guarantees
 * its methods do not run concurrently.
 *
 * The counter is per year, because the reference embeds the year and a fresh
 * year restarts the series.
 */

/**
 * Submitted cases live in their own numbering band so a reference can never
 * collide with a seeded demo fixture (which occupy 000101-000112).
 */
const SUBMITTED_BASE = 500_000;

export class ReferenceMinter extends DurableObject<CloudflareEnv> {
  /**
   * The next reference for `year`, reserved.
   *
   * Reserved, not suggested: the counter moves whether or not the caller goes
   * on to write the case. A gap in the series is a non-event; a duplicate is a
   * regulatory incident, so the trade is not close.
   *
   * `seed` is the highest number already in use, passed in on first call so an
   * existing database does not restart the series at 1 and collide with every
   * case already filed. It is used only when this object has no counter yet.
   */
  async next(year: number, seed: number): Promise<string> {
    const key = `counter:${year}`;
    const stored = await this.ctx.storage.get<number>(key);
    const current = stored ?? Math.max(seed, 0);
    const next = current + 1;

    // Written before it is returned. If the write fails the caller gets the
    // error and no reference, which is recoverable; returning first and
    // failing to persist would hand out a number this object would hand out
    // again.
    await this.ctx.storage.put(key, next);

    return CaseReference.parse(
      `SN-${year}-${String(SUBMITTED_BASE + next).padStart(6, "0")}`,
    );
  }
}

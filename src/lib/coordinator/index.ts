import "server-only";
import { audit } from "@/lib/audit";
import { getCloudflareEnv } from "@/lib/platform/env";
import {
  CLAIM_TTL_MINUTES,
  claimIsLive,
  type CaseClaim,
  type ClaimOutcome,
} from "@/lib/schemas/claim";
import type { ReviewerRuling } from "@/lib/schemas/assessment";
import type { IsoDate } from "@/lib/schemas/primitives";
import type { CoordinatorState, RuleOutcome } from "./case-coordinator";

/**
 * The app's view of case coordination.
 *
 * Every call site talks to this interface, and never to a Durable Object stub
 * directly. Two reasons, and the second is the one that matters:
 *
 * 1. `next dev` has no Durable Object binding, and the reviewer screens still
 *    have to work.
 * 2. A Durable Object stub is a network call dressed as a method call. Letting
 *    page components hold one would spread `idFromName` and RPC round trips
 *    through the UI layer, and the day the arbitration moves — to a facet, to
 *    a different key, to something that is not a DO at all — every one of them
 *    would need finding.
 */

export interface CaseCoordination {
  state(caseId: string): Promise<CoordinatorState>;
  claim(
    caseId: string,
    reviewerId: string,
    displayName: string,
  ): Promise<ClaimOutcome>;
  release(caseId: string, reviewerId: string): Promise<CoordinatorState>;
  rule(caseId: string, ruling: ReviewerRuling): Promise<RuleOutcome>;
  /** Idempotent. `null` stands the clock down. */
  armClock(
    caseId: string,
    reference: string,
    dueOn: IsoDate | null,
  ): Promise<void>;
  /** Next public reference for `year`. `seed` is only used on a cold counter. */
  mintReference(year: number, seed: number): Promise<string>;
  /** False when this is the in-process stand-in and not the real thing. */
  readonly arbitrates: boolean;
}

// ---------------------------------------------------------------------------
// The real one
// ---------------------------------------------------------------------------

class DurableObjectCoordination implements CaseCoordination {
  readonly arbitrates = true;
  readonly #cases: CloudflareEnv["CASE_COORDINATOR"];
  readonly #minter: CloudflareEnv["REFERENCE_MINTER"];

  constructor(
    cases: CloudflareEnv["CASE_COORDINATOR"],
    minter: CloudflareEnv["REFERENCE_MINTER"],
  ) {
    this.#cases = cases;
    this.#minter = minter;
  }

  /**
   * `idFromName(caseId)` — exactly as CLAUDE.md specifies.
   *
   * Written out rather than using `getByName` so the addressing scheme is
   * legible at the call site: the case id IS the object's name, which is why
   * two reviewers on the same case reach the same instance and two reviewers
   * on different cases never contend.
   */
  #forCase(caseId: string) {
    return this.#cases.get(this.#cases.idFromName(caseId));
  }

  state(caseId: string): Promise<CoordinatorState> {
    return this.#forCase(caseId).state(new Date().toISOString());
  }

  claim(
    caseId: string,
    reviewerId: string,
    displayName: string,
  ): Promise<ClaimOutcome> {
    return this.#forCase(caseId).claim(
      caseId,
      reviewerId,
      displayName,
      new Date().toISOString(),
    );
  }

  release(caseId: string, reviewerId: string): Promise<CoordinatorState> {
    return this.#forCase(caseId).release(
      caseId,
      reviewerId,
      new Date().toISOString(),
    );
  }

  rule(caseId: string, ruling: ReviewerRuling): Promise<RuleOutcome> {
    return this.#forCase(caseId).rule(
      caseId,
      ruling,
      new Date().toISOString(),
    );
  }

  armClock(
    caseId: string,
    reference: string,
    dueOn: IsoDate | null,
  ): Promise<void> {
    return this.#forCase(caseId).armClock(caseId, reference, dueOn);
  }

  /** One instance for the whole application — that is the point of it. */
  mintReference(year: number, seed: number): Promise<string> {
    const stub = this.#minter.get(this.#minter.idFromName("case-reference"));
    return stub.next(year, seed);
  }
}

// ---------------------------------------------------------------------------
// The stand-in
// ---------------------------------------------------------------------------

/**
 * In-process coordination, for `next dev` and for tests.
 *
 * `arbitrates` is false and the UI says so, because this is the one stand-in
 * in the codebase whose difference from the real thing is invisible in normal
 * use and catastrophic in the case the feature exists for. A Map arbitrates
 * perfectly between two tabs on one developer's laptop and not at all between
 * two reviewers on two machines — and the screen looks identical either way.
 *
 * Named for what it is, like UnprotectedBotGate.
 */
class UnarbitratedCoordination implements CaseCoordination {
  readonly arbitrates = false;
  readonly #claims = new Map<string, CaseClaim>();
  readonly #rulings = new Map<string, ReviewerRuling>();
  readonly #counters = new Map<number, number>();

  #live(caseId: string, now: string): CaseClaim | null {
    const claim = this.#claims.get(caseId);
    if (claim === undefined) return null;
    if (!claimIsLive(claim, now)) {
      this.#claims.delete(caseId);
      return null;
    }
    return claim;
  }

  async state(caseId: string): Promise<CoordinatorState> {
    return {
      claim: this.#live(caseId, new Date().toISOString()),
      ruling: this.#rulings.get(caseId) ?? null,
      clock: null,
    };
  }

  async claim(
    caseId: string,
    reviewerId: string,
    displayName: string,
  ): Promise<ClaimOutcome> {
    const now = new Date().toISOString();
    const existing = this.#live(caseId, now);

    if (existing !== null && existing.reviewerId !== reviewerId) {
      return { status: "refused", heldBy: existing };
    }

    const claim = {
      caseId,
      reviewerId,
      displayName,
      claimedAt: existing?.claimedAt ?? now,
      expiresAt: new Date(
        Date.parse(now) + CLAIM_TTL_MINUTES * 60_000,
      ).toISOString(),
    } as CaseClaim;

    this.#claims.set(caseId, claim);
    return existing === null
      ? { status: "granted", claim }
      : { status: "refreshed", claim };
  }

  async release(
    caseId: string,
    reviewerId: string,
  ): Promise<CoordinatorState> {
    const existing = this.#live(caseId, new Date().toISOString());
    if (existing?.reviewerId === reviewerId) this.#claims.delete(caseId);
    return this.state(caseId);
  }

  async rule(caseId: string, ruling: ReviewerRuling): Promise<RuleOutcome> {
    const existing = this.#live(caseId, new Date().toISOString());
    if (existing === null) {
      return {
        ok: false,
        reason: "Claim this case before ruling on it.",
        state: await this.state(caseId),
      };
    }
    if (existing.reviewerId !== ruling.decidedBy) {
      return {
        ok: false,
        reason: `${existing.displayName} is holding this case.`,
        state: await this.state(caseId),
      };
    }
    this.#rulings.set(caseId, ruling);
    return { ok: true, reason: null, state: await this.state(caseId) };
  }

  async armClock(
    _caseId: string,
    reference: string,
    dueOn: IsoDate | null,
  ): Promise<void> {
    // Standing a clock down is a no-op with nothing to stand down, so it says
    // nothing. The nightly sweep calls this for EVERY open case, most of which
    // want no clock at all, and logging those produced a failure line per case
    // per night — a wall of red about work nobody asked for, which is how a log
    // stops being read.
    if (dueOn === null) return;

    // There is no alarm without a Durable Object, and there is no honest way
    // to fake one — a setTimeout dies with the process and would be a promise
    // to notify that nothing keeps. So a clock that was genuinely WANTED and
    // cannot be armed is still reported, every time.
    audit({
      actor: "system",
      action: "arm_expedited_clock",
      target: reference,
      outcome: "failure",
      detail: { reason: "no_durable_object_bound", dueOn },
    });
  }

  async mintReference(year: number, seed: number): Promise<string> {
    const current = this.#counters.get(year) ?? Math.max(seed, 0);
    const next = current + 1;
    this.#counters.set(year, next);
    return `SN-${year}-${String(500_000 + next).padStart(6, "0")}`;
  }
}

const standIn = new UnarbitratedCoordination();

export async function getCaseCoordination(): Promise<CaseCoordination> {
  const env = await getCloudflareEnv();
  const cases = env?.CASE_COORDINATOR;
  const minter = env?.REFERENCE_MINTER;
  if (cases === undefined || minter === undefined) return standIn;
  return new DurableObjectCoordination(cases, minter);
}

export type { CoordinatorState, RuleOutcome };

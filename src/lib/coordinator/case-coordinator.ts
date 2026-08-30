import { DurableObject } from "cloudflare:workers";
import { audit } from "@/lib/audit";
import {
  claimExpiryFrom,
  claimIsLive,
  type CaseClaim,
  type ClaimOutcome,
} from "@/lib/case/claim";
import type { ReviewerRuling } from "@/lib/schemas/assessment";
import type { IsoDate } from "@/lib/schemas/primitives";

/**
 * One case, one reviewer — arbitrated in one place.
 *
 * CLAUDE.md: "One case = one reviewer; verdict; regulatory clock alarm |
 * Durable Object, `idFromName(caseId)`". All three live here, and they live
 * together for a reason: they are the three facts about a case that must never
 * be observed in two different versions at once.
 *
 * WHY A DURABLE OBJECT AND NOT A ROW WITH A LOCK COLUMN.
 *
 * The row version has a race in it that testing does not find. Two reviewers
 * press Claim in the same second; both SELECT, both see NULL, both UPDATE,
 * both are told they have it, and the app has just done the one thing it
 * exists to prevent. Fixing that in D1 means a compare-and-set and a retry
 * loop, written correctly, at every call site, forever.
 *
 * `idFromName(caseId)` gives one object per case and the platform guarantees
 * its methods do not run concurrently. The race is not handled; it cannot be
 * expressed. That is the whole argument.
 *
 * THE ALARM IS NOT THE NIGHTLY SWEEP.
 *
 * Cluster F runs a cron sweep over every open case. This alarm fires once, for
 * this case, at the moment its 15-day expedited deadline passes. They overlap
 * on purpose and they are not redundant: the alarm is precise but exists only
 * if something armed it, and the sweep is coarse but sees cases whose alarm was
 * never armed — a case imported before this class existed, or one whose arming
 * write failed. A deadline in a pharmacovigilance system is exactly the kind of
 * thing that deserves two independent ways of being noticed.
 */

const STORAGE_KEY = {
  claim: "claim",
  ruling: "ruling",
  clock: "clock",
} as const;

/**
 * IDEMPOTENCY, AND WHY A SERIALISED OBJECT STILL NEEDS IT.
 *
 * The Durable Object already stops two reviewers claiming at once — that is
 * what it is for. What it does not stop is the SAME reviewer's request
 * arriving twice: a double-click, a browser retry on a flaky connection, a
 * Server Action replayed after a timeout the client saw and the server did
 * not. Serialisation orders those two; it does not merge them.
 *
 * Mostly that is harmless here, because claim and rule are close to
 * idempotent by construction. `rule` is the one that is not: a reviewer who
 * double-submits a ruling gets two audit lines, two `rule_case` records, and a
 * regulatory trail that says a determination was made twice at different
 * instants. In a system whose whole pitch is that every decision is logged, a
 * duplicated decision is a defect in the log, not a cosmetic one.
 *
 * So every mutating method takes a key, the first result under that key is
 * stored, and a replay returns it verbatim — without re-running the mutation
 * and without emitting a second audit line.
 */
const IDEMPOTENCY_PREFIX = "idem:";

/**
 * How long a key is honoured.
 *
 * Long enough to cover a retry, a reload and a reviewer coming back from a
 * broken connection; short enough that the object's storage does not grow
 * without bound. Swept by an alarm rather than on read, so a key that is never
 * asked about again is still collected.
 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredResult<T> {
  readonly result: T;
  readonly storedAt: number;
}

/** What the alarm was armed for, so a fired alarm can explain itself. */
interface ArmedClock {
  readonly caseId: string;
  readonly reference: string;
  readonly dueOn: IsoDate;
  readonly armedAt: string;
}

export interface CoordinatorState {
  readonly claim: CaseClaim | null;
  readonly ruling: ReviewerRuling | null;
  readonly clock: ArmedClock | null;
}

export interface RuleOutcome {
  readonly ok: boolean;
  /** Why not, when `ok` is false. Shown to the reviewer. */
  readonly reason: string | null;
  readonly state: CoordinatorState;
}

export class CaseCoordinator extends DurableObject<CloudflareEnv> {
  /**
   * Run `work` once per key, or return what it returned the first time.
   *
   * `key` is optional so that a caller with nothing to be idempotent about —
   * a read, a sweep — is not forced to invent one. Passing null runs the work
   * every time, which is the old behaviour and is correct for those.
   *
   * The stored result is written BEFORE returning, inside the same
   * single-threaded turn as the mutation, so there is no window in which the
   * work has happened and the key does not yet record it.
   */
  async #once<T>(key: string | null, work: () => Promise<T>): Promise<T> {
    if (key === null || key === "") return work();

    const slot = `${IDEMPOTENCY_PREFIX}${key}`;
    const seen = await this.ctx.storage.get<StoredResult<T>>(slot);
    if (seen !== undefined) return seen.result;

    const result = await work();
    await this.ctx.storage.put(slot, {
      result,
      storedAt: Date.now(),
    } satisfies StoredResult<T>);

    // The sweep needs an alarm to exist. Only set one if nothing else has —
    // the expedited clock's alarm is the other user of this slot and it is far
    // more important, so it always wins.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + IDEMPOTENCY_TTL_MS);
    }

    return result;
  }

  /** Drop keys past their window. Called from the alarm. */
  async #sweepIdempotencyKeys(): Promise<number> {
    const entries = await this.ctx.storage.list<StoredResult<unknown>>({
      prefix: IDEMPOTENCY_PREFIX,
    });
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    const stale = [...entries]
      .filter(([, value]) => value.storedAt < cutoff)
      .map(([slot]) => slot);
    if (stale.length > 0) await this.ctx.storage.delete(stale);
    return stale.length;
  }

  /**
   * The live claim, or null.
   *
   * Expiry is applied on READ rather than by a timer. A timer would mean the
   * lapse depends on the object still being awake, and a Durable Object that
   * nobody has touched for an hour is not awake — so a claim would expire only
   * once somebody arrived to be blocked by it, which is precisely when it must
   * already be gone.
   */
  async #liveClaim(now: string): Promise<CaseClaim | null> {
    const stored = await this.ctx.storage.get<CaseClaim>(STORAGE_KEY.claim);
    if (stored === undefined) return null;
    return claimIsLive(stored, now) ? stored : null;
  }

  async state(now: string): Promise<CoordinatorState> {
    const [claim, ruling, clock] = await Promise.all([
      this.#liveClaim(now),
      this.ctx.storage.get<ReviewerRuling>(STORAGE_KEY.ruling),
      this.ctx.storage.get<ArmedClock>(STORAGE_KEY.clock),
    ]);
    return {
      claim,
      ruling: ruling ?? null,
      clock: clock ?? null,
    };
  }

  /**
   * Take the case, or be told who has it.
   *
   * Re-claiming a case you already hold REFRESHES it rather than failing. A
   * reviewer who reloads the page has not lost their claim, and a system that
   * says "you cannot have this, you have it" is one people learn to distrust.
   */
  async claim(
    caseId: string,
    reviewerId: string,
    displayName: string,
    now: string,
    idempotencyKey: string | null = null,
  ): Promise<ClaimOutcome> {
    return this.#once(idempotencyKey, async () => {
      const existing = await this.#liveClaim(now);

      if (existing !== null && existing.reviewerId !== reviewerId) {
        audit({
          actor: reviewerId,
          action: "claim_case",
          target: caseId,
          outcome: "rejected",
          detail: { heldBy: existing.reviewerId },
        });
        return { kind: "held_by_other", claim: existing };
      }

      const claim: CaseClaim = {
        reviewerId,
        displayName,
        heldSince: existing?.heldSince ?? now,
        expiresAt: claimExpiryFrom(now),
      };

      await this.ctx.storage.put(STORAGE_KEY.claim, claim);

      audit({
        actor: reviewerId,
        action: "claim_case",
        target: caseId,
        outcome: "success",
        detail: { refreshed: existing !== null },
      });

      return existing === null
        ? { kind: "granted", claim }
        : { kind: "already_yours", claim };
    });
  }

  /**
   * Give it back.
   *
   * Only the holder may release. Otherwise "release" is just "steal" spelled
   * politely, and the guarantee this class exists for is gone.
   */
  async release(
    caseId: string,
    reviewerId: string,
    now: string,
    idempotencyKey: string | null = null,
  ): Promise<CoordinatorState> {
    return this.#once(idempotencyKey, async () => {
      const existing = await this.#liveClaim(now);
      if (existing !== null && existing.reviewerId === reviewerId) {
        await this.ctx.storage.delete(STORAGE_KEY.claim);
        audit({
          actor: reviewerId,
          action: "release_case",
          target: caseId,
          outcome: "success",
        });
      }
      return this.state(now);
    });
  }

  /**
   * Record the reviewer's decision.
   *
   * Requires the claim. A ruling from someone who does not hold the case means
   * two people decided it, which is the same failure as two people opening it
   * but with a regulatory consequence attached.
   *
   * The ruling is stored here AND mirrored into D1 by the caller. This is the
   * authority; D1 is the queryable copy.
   */
  async rule(
    caseId: string,
    ruling: ReviewerRuling,
    now: string,
    idempotencyKey: string | null = null,
  ): Promise<RuleOutcome> {
    /*
      The method this whole mechanism exists for.

      A double-submitted ruling is not a harmless repeat: it writes two
      `rule_case` lines at different instants, so the audit trail says a
      determination was made twice. In a system whose pitch is that every
      decision is logged, that is a defect in the log itself.
    */
    return this.#once(idempotencyKey, async () => {
      const existing = await this.#liveClaim(now);

      if (existing === null) {
        audit({
          actor: ruling.decidedBy,
          action: "rule_case",
          target: caseId,
          outcome: "rejected",
          detail: { reason: "no_claim" },
        });
        return {
          ok: false,
          reason: "Claim this case before ruling on it.",
          state: await this.state(now),
        };
      }

      if (existing.reviewerId !== ruling.decidedBy) {
        audit({
          actor: ruling.decidedBy,
          action: "rule_case",
          target: caseId,
          outcome: "rejected",
          detail: { reason: "claimed_by_other", heldBy: existing.reviewerId },
        });
        return {
          ok: false,
          reason: `${existing.displayName} is holding this case.`,
          state: await this.state(now),
        };
      }

      await this.ctx.storage.put(STORAGE_KEY.ruling, ruling);

      audit({
        actor: ruling.decidedBy,
        action: "rule_case",
        target: caseId,
        outcome: "success",
        detail: {
          listedness: ruling.listedness,
          expectedness: ruling.expectedness,
        },
      });

      return { ok: true, reason: null, state: await this.state(now) };
    });
  }

  /**
   * Arm the 15-day clock, or stand it down.
   *
   * Idempotent by design — the nightly sweep re-arms every open expedited case
   * on every run, and re-arming an already-armed clock must not move the
   * deadline or emit a second audit line. `dueOn` is the deadline, not a
   * duration, so re-arming with the same date is a no-op by construction.
   */
  async armClock(
    caseId: string,
    reference: string,
    dueOn: IsoDate | null,
  ): Promise<void> {
    const current = await this.ctx.storage.get<ArmedClock>(STORAGE_KEY.clock);

    if (dueOn === null) {
      if (current === undefined) return;
      await this.ctx.storage.delete(STORAGE_KEY.clock);
      await this.ctx.storage.deleteAlarm();
      audit({
        actor: "system",
        action: "disarm_expedited_clock",
        target: reference,
        outcome: "success",
      });
      return;
    }

    if (current?.dueOn === dueOn) return;

    const armed: ArmedClock = {
      caseId,
      reference,
      dueOn,
      armedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(STORAGE_KEY.clock, armed);

    // End of the due day, UTC. The regulation counts days, not hours, so a
    // case is late the moment the day after the deadline begins — not 24 hours
    // after whatever time of day the report happened to arrive.
    await this.ctx.storage.setAlarm(Date.parse(`${dueOn}T23:59:59.999Z`) + 1);

    audit({
      actor: "system",
      action: "arm_expedited_clock",
      target: reference,
      outcome: "success",
      detail: { dueOn },
    });
  }

  /**
   * The deadline passed.
   *
   * This does not change the case. `expeditedClock()` already derives "overdue"
   * from the receipt date and today, so writing a status here would create a
   * second source of truth that could disagree with the first. What the alarm
   * adds is the MOMENT — a line in the audit log at the instant the obligation
   * was missed, rather than a state a reviewer might infer later from a date
   * subtraction.
   */
  override async alarm(): Promise<void> {
    /*
      The alarm slot is shared, so this handler must not assume why it fired.

      An object may have an expedited deadline armed, or only idempotency keys
      to collect, or both — there is one alarm per Durable Object and both
      users want it. Sweeping first and unconditionally means a fired alarm is
      never wasted, and the deadline branch below still runs when there is one.
    */
    const collected = await this.#sweepIdempotencyKeys();

    const armed = await this.ctx.storage.get<ArmedClock>(STORAGE_KEY.clock);
    if (armed === undefined) {
      // Nothing armed. Re-arm only if there are still keys to age out, so an
      // idle object stops waking up entirely.
      const remaining = await this.ctx.storage.list({
        prefix: IDEMPOTENCY_PREFIX,
        limit: 1,
      });
      if (remaining.size > 0) {
        await this.ctx.storage.setAlarm(Date.now() + IDEMPOTENCY_TTL_MS);
      }
      if (collected > 0) {
        audit({
          actor: "system",
          action: "sweep_idempotency_keys",
          target: "case_coordinator",
          outcome: "success",
          detail: { collected },
        });
      }
      return;
    }

    const claim = await this.ctx.storage.get<CaseClaim>(STORAGE_KEY.claim);
    const ruling = await this.ctx.storage.get<ReviewerRuling>(
      STORAGE_KEY.ruling,
    );

    audit({
      actor: "system",
      action: "expedited_deadline_reached",
      target: armed.reference,
      outcome: "failure",
      detail: {
        dueOn: armed.dueOn,
        // Both worth knowing at 15 days: an unruled case nobody claimed is a
        // different kind of miss from one a reviewer has been sitting on.
        wasRuled: ruling !== undefined,
        heldBy: claim?.reviewerId ?? "nobody",
      },
    });
  }
}

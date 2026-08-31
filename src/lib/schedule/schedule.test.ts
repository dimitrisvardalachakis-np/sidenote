import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRON, runScheduled } from "./run";

/**
 * Cron dispatch.
 *
 * Small surface, two properties worth holding still, both about failing
 * visibly. A cron job is the least observed code in any system: nobody is
 * watching at 02:00, and the next chance to notice is 24 hours away. So the
 * two things that must never happen are silence on an unknown schedule and
 * silence on a crash.
 */

function auditLines(logged: string[]): ReadonlyArray<Record<string, unknown>> {
  return logged
    .filter((line) => line.startsWith("[AUDIT] "))
    .map(
      (line) =>
        JSON.parse(line.slice("[AUDIT] ".length)) as Record<string, unknown>,
    );
}

function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return lines;
}

const NOON = Date.parse("2026-08-25T12:00:00.000Z");

/*
  THIS SUITE USED TO CALL api.fda.gov, ONCE PER SUSPECT SUBSTANCE, FOR REAL.

  `runLabelDiff` reads every open case, collects the distinct suspect
  substances and fetches a label for each, serially. Under vitest `getDb()` is
  null and `hasLocalDisk()` is true, so `getCaseStore()` returned the DISK
  store and read the developer's own `.data/cases` — nine cases, five
  substances, 8.3 seconds of network measured against vitest's 5 second
  default timeout. It passed most of the time because keep-alive collapses the
  later requests, and failed about one run in six under `pool: "forks"` with
  ten children competing for the CPU and the uplink.

  The failure was a TIMEOUT, not an assertion mismatch, which is what made it
  hard to read: both audit lines the test wants are already captured by then,
  because `runDeadlineSweep` runs before `runLabelDiff`. Worse, vitest cannot
  cancel the abandoned promise, so the late `label_diff_sweep` line landed in
  the NEXT test's captured array — where that test's assertion happened to
  accept it, and passed for the wrong reason.

  It also grew with use: `.data` is gitignored, so a fresh clone made zero
  network calls and every report filed through the app made this slower.

  Pretending to be Workers is the whole fix. `storageBacking()` becomes
  "ephemeral", `getCaseStore()` returns the in-memory store, `list()` is empty,
  and the loop that fetches never runs. Nothing here asserts on case data, so
  every assertion below is unchanged.
*/
function pretendToBeWorkers(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

function resetEphemeralStores(): void {
  delete (globalThis as unknown as { __sidenoteEphemeralStores?: unknown })
    .__sidenoteEphemeralStores;
}

/*
  And a guard, so this cannot come back quietly.

  Every other suite that touches openFDA — openfda.test.ts, acquire.test.ts —
  stubs fetch. This one was the exception, which is exactly why nobody noticed
  it was on the network. Throwing rather than returning a canned response is
  deliberate: there is no request this suite should be making, so the honest
  stub is one that fails loudly if the store ever starts returning cases again.
*/
const realFetch = globalThis.fetch;

function refuseNetwork(): void {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    throw new Error(
      `schedule.test.ts must not reach the network — tried ${String(url)}`,
    );
  }) as typeof fetch;
}

beforeEach(() => {
  resetEphemeralStores();
  pretendToBeWorkers();
  refuseNetwork();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cron expressions", () => {
  it("are the ones wrangler.jsonc fires, spelled the same way", () => {
    // Matched literally in runScheduled. Two spellings of the same schedule is
    // how a job silently stops running.
    expect(CRON.deadlineSweep).toBe("0 2 * * *");
    expect(CRON.labelDiff).toBe("0 3 * * *");
    expect(CRON.deadlineSweep).not.toBe(CRON.labelDiff);
  });
});

describe("runScheduled", () => {
  it("runs the deadline sweep on its schedule", async () => {
    const logged = capture();
    await runScheduled(CRON.deadlineSweep, {} as CloudflareEnv, NOON);

    expect(auditLines(logged)).toContainEqual(
      expect.objectContaining({ action: "deadline_sweep" }),
    );
  });

  it("reasons about the day the trigger was scheduled for, not today", async () => {
    const logged = capture();
    await runScheduled(CRON.deadlineSweep, {} as CloudflareEnv, NOON);

    const sweep = auditLines(logged).find(
      (line) => line["action"] === "deadline_sweep",
    );
    // A cron that fires late — and they do — must still compute deadlines
    // against the day it was scheduled for. `new Date()` inside the sweep
    // would quietly give a different answer on a retry the next morning.
    expect(sweep?.["target"]).toBe("2026-08-25");
  });

  it("does something, and says so, on a schedule it does not recognise", async () => {
    const logged = capture();
    await runScheduled("*/5 * * * *", {} as CloudflareEnv, NOON);

    const lines = auditLines(logged);
    // An unrecognised expression means somebody added a schedule without
    // wiring it up. Doing nothing would be indistinguishable from working.
    expect(lines).toContainEqual(
      expect.objectContaining({ action: "cron_unrecognised" }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ action: "deadline_sweep" }),
    );
  });

  it("records a crash instead of unwinding into nothing", async () => {
    const logged = capture();
    // Nobody is watching at 02:00 and the next run is 24 hours away, so an
    // exception that escapes is an outage that lasts a day and leaves no trace.
    await expect(
      runScheduled(CRON.labelDiff, null as unknown as CloudflareEnv, NaN),
    ).resolves.toBeUndefined();

    const lines = auditLines(logged);
    expect(
      lines.some(
        (line) =>
          line["action"] === "cron_failed" ||
          line["action"] === "label_diff_sweep",
      ),
    ).toBe(true);
  });
});

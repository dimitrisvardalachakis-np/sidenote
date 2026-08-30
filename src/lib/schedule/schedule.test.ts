import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
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

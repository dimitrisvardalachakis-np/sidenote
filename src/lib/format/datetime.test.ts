/**
 * The bug these pin is a three-hour window.
 *
 * Athens is UTC+2 in winter and UTC+3 in summer, so between midnight and
 * 02:00 or 03:00 local, `new Date().toISOString().slice(0, 10)` names the
 * previous day. That string was the `today` fed to `expeditedClock` on six
 * screens: every 15-day deadline and every "due today" badge was a day out,
 * every night, in the direction of reporting late. The tests below use
 * instants inside that window on purpose.
 *
 * Both offsets are covered, because a formatter that hard-codes +2 is right
 * for five months of the year and wrong for the demo.
 */
import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatTime,
  todayInAthens,
} from "./datetime";

describe("Athens summer time (UTC+3)", () => {
  // The reported bug, exactly: claimed 12:16 in Athens, displayed 09:16.
  it("shows a claim made at 12:16 Athens as 12:16", () => {
    expect(formatTime("2026-09-04T09:16:00.000Z")).toBe("12:16");
  });

  it("carries the date alongside the time", () => {
    expect(formatDateTime("2026-09-04T09:16:00.000Z")).toBe("2026-09-04 12:16");
  });
});

describe("Athens winter time (UTC+2)", () => {
  it("shifts by two hours rather than three", () => {
    expect(formatDateTime("2026-01-15T09:16:00.000Z")).toBe("2026-01-15 11:16");
  });
});

describe("the three-hour window that moved every deadline", () => {
  it("calls 00:30 Athens today, not yesterday", () => {
    // 21:30 UTC on the 3rd is 00:30 on the 4th in Athens.
    const instant = new Date("2026-09-03T21:30:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(todayInAthens(instant)).toBe("2026-09-04");
  });

  it("agrees with the UTC slice for the rest of the day", () => {
    const instant = new Date("2026-09-04T09:16:00.000Z");
    expect(todayInAthens(instant)).toBe("2026-09-04");
  });

  it("rolls the date forward at Athens midnight, not UTC midnight", () => {
    expect(todayInAthens(new Date("2026-09-03T20:59:59.000Z"))).toBe("2026-09-03");
    expect(todayInAthens(new Date("2026-09-03T21:00:00.000Z"))).toBe("2026-09-04");
  });
});

describe("hour formatting", () => {
  /*
    `hour12: false` alone renders midnight as "24:00" in some locale data.
    `hourCycle: "h23"` is what pins it, and this is the assertion that would
    catch the option being dropped.
  */
  it("renders midnight as 00, not 24", () => {
    expect(formatTime("2026-09-03T21:00:00.000Z")).toBe("00:00");
  });

  it("zero-pads the date parts", () => {
    expect(formatDate("2026-01-05T12:00:00.000Z")).toBe("2026-01-05");
  });
});

describe("an unparseable value", () => {
  /*
    Returned unchanged rather than thrown. These run inside server components,
    and a formatting fault that 500s the case screen would stop a reviewer
    claiming and ruling — the human write must survive anything cosmetic.
  */
  it("comes back as it went in", () => {
    expect(formatDateTime("not a date")).toBe("not a date");
    expect(formatDate("")).toBe("");
    expect(formatTime("2026-13-45T99:99:99Z")).toBe("2026-13-45T99:99:99Z");
  });
});

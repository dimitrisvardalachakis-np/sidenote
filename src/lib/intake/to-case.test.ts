import { describe, expect, it } from "vitest";
import { CaseReference } from "@/lib/schemas";
import { intakeToCase } from "./to-case";

describe("the contact answer, as people actually write it", () => {
  /*
    Every case here is a real answer shape that used to destroy the report.

    The old test was anchored — the whole answer had to BE an email — so
    anything else went wholesale into `phone`, which the schema caps at 40
    characters. A reporter who answered the question "an email address or
    phone number" with both got a validation failure at the last step of an
    eight-question conversation, lost the report, and was told to press send
    again, which failed identically every time.
  */
  const expectReporter = (answer: string) => {
    const reporter = contactOf(answer);
    if (reporter === null) throw new Error("no reporter was produced");
    return reporter;
  };

  const contactOf = (answer: string) =>
    intakeToCase({
      slots: {
        narrative: "after my injection I felt dizzy",
        drug: "moderna",
        reaction: "dizziness",
        age: 37,
        sex: "male",
        seriousness: [],
        seriousnessEvidence: [],
        reporterName: "Dimitris Vardalachakis",
        reporterContact: answer,
        dose: null,
        route: null,
        outcome: null,
        therapyStart: null,
        therapyEnd: null,
        reactionOnset: null,
      },
      reference: CaseReference.parse("SN-2026-500001"),
      receivedAt: "2026-08-28",
      now: "2026-08-28T00:00:00.000Z",
      ids: {
        caseId: "00000000-0000-4000-8000-000000000001",
        drugId: "00000000-0000-4000-8000-000000000002",
        reactionId: "00000000-0000-4000-8000-000000000003",
      },
    }).reporter;


  it("takes both when both are given — the answer that lost a real report", () => {
    const r = expectReporter("dimitrisvard@hotmaill.com and +306970077401");
    expect(r.email).toBe("dimitrisvard@hotmaill.com");
    expect(r.phone).toBe("+306970077401");
  });

  it("does not read digits out of the email as a phone number", () => {
    const r = expectReporter("dimitris2024@example.com");
    expect(r.email).toBe("dimitris2024@example.com");
    expect(r.phone).toBeNull();
  });

  it("takes an email on its own", () => {
    const r = expectReporter("someone@example.com");
    expect(r.email).toBe("someone@example.com");
    expect(r.phone).toBeNull();
  });

  it("takes a phone on its own", () => {
    const r = expectReporter("+30 697 0077401");
    expect(r.email).toBeNull();
    expect(r.phone).toBe("+30 697 0077401");
  });

  it("keeps the report alive when the answer matches neither pattern", () => {
    // Losing the report is far worse than recording an imperfect contact.
    const r = expectReporter("ask for me at the front desk on the third floor please");
    expect(r.phone).not.toBeNull();
    expect((r.phone ?? "").length).toBeLessThanOrEqual(40);
  });

  it("never exceeds the schema cap, whatever was typed", () => {
    const r = expectReporter(`${"9".repeat(200)}`);
    expect((r.phone ?? "").length).toBeLessThanOrEqual(40);
  });
});

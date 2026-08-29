import { describe, expect, it } from "vitest";
import { dailyMedUrl } from "./dailymed";

const SET_ID = "9c1c1e6d-6f3a-4d4a-9d1c-2b0f6a1e7c33";

describe("dailyMedUrl", () => {
  it("builds a DailyMed link from an SPL set id", () => {
    expect(dailyMedUrl(SET_ID, "public")).toBe(
      `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${SET_ID}`,
    );
  });

  it("normalises case, because openFDA set ids are lowercase", () => {
    expect(dailyMedUrl(SET_ID.toUpperCase(), "public")).toContain(SET_ID);
  });

  /*
    The refusal that matters. A company document id is a uuid we minted
    ourselves; handing it to DailyMed makes a dead link that looks like a
    citation, and implies a confidential CCDS has a public page to check it
    against. It does not.
  */
  it("refuses a company document, whatever its id looks like", () => {
    expect(dailyMedUrl(SET_ID, "company")).toBeNull();
  });

  it("refuses anything that is not a set id, rather than linking to a 404", () => {
    expect(dailyMedUrl("ccds-7.2", "public")).toBeNull();
    expect(dailyMedUrl("", "public")).toBeNull();
    expect(dailyMedUrl("not-a-uuid-at-all", "public")).toBeNull();
    expect(dailyMedUrl(null, "public")).toBeNull();
  });
});

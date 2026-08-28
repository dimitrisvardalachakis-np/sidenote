/**
 * The openFDA client, and the three defects that only showed up against real
 * labels. Every one of these tests exists because a live fetch produced
 * something wrong, not because the case was imagined up front.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assembleLabelText,
  fetchLabel,
  sanitiseDrugName,
  splitSectionMarkers,
} from "./openfda";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(body: unknown, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const label = (over: Record<string, unknown> = {}) => ({
  effective_time: "20250828",
  openfda: {
    brand_name: ["Atorvastatin calcium"],
    generic_name: ["atorvastatin calcium"],
    substance_name: ["ATORVASTATIN CALCIUM TRIHYDRATE"],
    spl_set_id: ["00afce9b-48c9-487a-a738-e359c005c707"],
  },
  adverse_reactions: ["6 ADVERSE REACTIONS Nausea was reported commonly."],
  ...over,
});

describe("splitSectionMarkers: an incidence table is not a section", () => {
  /*
    THE DEFECT THIS CAUGHT. openFDA flattens the adverse-reaction incidence
    tables into the same run of text as the prose, so a row reads
    "6.8 Pain in extremity 5.9 8.5 3.7 9.3 3.1". Treating that as a subsection
    printed the section path "6 ADVERSE REACTIONS › 6.8 Pain in extremity 5.9
    8.5 3.7 9.3 3.1" underneath a reviewer's citation — a location that does
    not exist, attached to a real quotation.
  */
  it("does not split on a table row whose figures look like a section number", () => {
    const text =
      "6 ADVERSE REACTIONS The rates were as follows. 6.8 Pain in extremity 5.9 8.5 3.7 9.3 3.1 6.9 Diarrhea 6.3 7.3";
    const out = splitSectionMarkers(text, "6");
    expect(out).not.toMatch(/\n6\.8 Pain in extremity/);
    expect(out).not.toMatch(/\n6\.9 Diarrhea/);
  });

  it("does split on a real subsection followed by a sentence", () => {
    const text =
      "6 ADVERSE REACTIONS Overall summary here. 6.1 Clinical Trials Experience Because clinical trials are conducted under varying conditions.";
    const out = splitSectionMarkers(text, "6");
    expect(out).toMatch(/\n6\.1 Clinical Trials Experience\n/);
  });

  it("ignores a subsection belonging to a different section", () => {
    // "3.0 Pharyngolaryngeal pain" is a table row inside section 6, and its
    // leading figure is not a subsection of 6 at all.
    const text = "6 ADVERSE REACTIONS Rates. 3.0 Pharyngolaryngeal pain 2.1 3.9";
    expect(splitSectionMarkers(text, "6")).not.toMatch(/\n3\.0/);
  });

  it("puts a leading shouted heading on its own line", () => {
    const out = splitSectionMarkers(
      "4 CONTRAINDICATIONS Acute liver failure or decompensated cirrhosis.",
      "4",
    );
    expect(out.split("\n")[0]).toBe("4 CONTRAINDICATIONS");
  });

  it("never removes or reorders a character of the label's own words", () => {
    const text =
      "6 ADVERSE REACTIONS Overall summary. 6.1 Clinical Trials Experience Because trials vary.";
    const out = splitSectionMarkers(text, "6");
    // Only whitespace may differ: the words must survive exactly.
    expect(out.replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
});

describe("assembleLabelText", () => {
  it("keeps only the safety sections", () => {
    const out = assembleLabelText({
      adverse_reactions: ["6 ADVERSE REACTIONS Nausea was common."],
      inactive_ingredient: ["Contains lactose, magnesium stearate."],
      clinical_pharmacology: ["Atorvastatin is a selective inhibitor."],
    });
    expect(out).toContain("Nausea was common");
    // Noise that cannot answer "is this reaction described" stays out.
    expect(out).not.toContain("magnesium stearate");
    expect(out).not.toContain("selective inhibitor");
  });

  it("does not double a heading the label already carries", () => {
    const out = assembleLabelText({
      adverse_reactions: ["6 ADVERSE REACTIONS Nausea was common."],
    });
    expect(out.match(/6 ADVERSE REACTIONS/g)).toHaveLength(1);
  });

  it("supplies a heading when the label carries none", () => {
    /*
      Sertraline's boxed warning arrives as one run-on beginning "BOXED
      WARNING Suicidality and Antidepressant Drugs …" — it merely starts with
      the words, it does not carry them as a heading line. Suppressing ours on
      a prefix match left that passage with no section path at all.
    */
    const out = assembleLabelText({
      boxed_warning: ["BOXED WARNING Suicidality and Antidepressant Drugs increased the risk."],
    });
    expect(out.startsWith("BOXED WARNING\n\n")).toBe(true);
  });

  it("covers over-the-counter Drug Facts sections too", () => {
    const out = assembleLabelText({
      do_not_use: ["Do not use if you have ever had an allergic reaction."],
      stop_use: ["Stop use and ask a doctor if you experience bleeding."],
    });
    expect(out).toContain("DO NOT USE");
    expect(out).toContain("STOP USE AND ASK A DOCTOR IF");
  });
});

describe("sanitiseDrugName", () => {
  it("strips anything that could reshape the search query", () => {
    // The name goes into a Lucene-style search parameter, so a quote or a bare
    // boolean would change the query rather than be searched for.
    expect(sanitiseDrugName('ibuprofen" OR openfda.brand_name:"*')).toBe(
      "ibuprofen OR openfda brand name",
    );
  });

  it("keeps ordinary names intact", () => {
    expect(sanitiseDrugName("  Atorvastatin-Calcium  ")).toBe("Atorvastatin-Calcium");
  });
});

describe("fetchLabel", () => {
  it("maps a label onto a SafetyDocument", async () => {
    stub({ results: [label()] });
    const out = await fetchLabel("atorvastatin");

    expect(out.status).toBe("found");
    if (out.status !== "found") return;
    const d = out.label.document;
    // The SPL set id IS the document id, so a citation traces to a public
    // FDA record and a re-fetch replaces rather than duplicates.
    expect(d.id).toBe("00afce9b-48c9-487a-a738-e359c005c707");
    expect(d.sourceType).toBe("public");
    expect(d.kind).toBe("fda_label");
    expect(d.effectiveDate).toBe("2025-08-28");
    // Generic name, not the substance record's longer form: scope matching is
    // a prefix comparison, so the canonical form matches more of what a
    // reporter types.
    expect(d.activeSubstance).toBe("atorvastatin calcium");
  });

  it("skips a result with no SPL set id and takes the next usable one", async () => {
    /*
      "lisinopril" failed outright before this: hundreds of repackager labels
      match the name and the first carried no set id, so a real, common drug
      returned nothing at all.
    */
    stub({
      results: [
        { openfda: { brand_name: ["No Id"] }, adverse_reactions: ["6 ADVERSE REACTIONS x"] },
        label(),
      ],
    });
    const out = await fetchLabel("atorvastatin");
    expect(out.status).toBe("found");
  });

  it("skips a result that has an id but no safety sections", async () => {
    stub({
      results: [
        {
          openfda: { spl_set_id: ["11111111-1111-4111-8111-111111111111"] },
          inactive_ingredient: ["lactose"],
        },
        label(),
      ],
    });
    const out = await fetchLabel("atorvastatin");
    expect(out.status).toBe("found");
    if (out.status !== "found") return;
    expect(out.label.document.id).toBe("00afce9b-48c9-487a-a738-e359c005c707");
  });

  it("treats a 404 as not_found, not as a failure", async () => {
    // openFDA answered clearly. Reporting that as an outage would tell a
    // reporter the service was unreachable when it simply has no such label.
    stub({ error: { code: "NOT_FOUND" } }, 404);
    const out = await fetchLabel("notarealmedicine");
    expect(out.status).toBe("not_found");
  });

  it("reports unavailable when openFDA errors", async () => {
    stub({ error: "boom" }, 500);
    const out = await fetchLabel("atorvastatin");
    expect(out.status).toBe("unavailable");
  });

  it("never throws on a transport failure", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("dns"))) as typeof fetch;
    await expect(fetchLabel("atorvastatin")).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("refuses a name too short to identify a medicine", async () => {
    const calls = stub({ results: [label()] });
    const out = await fetchLabel("a");
    expect(out.status).toBe("not_found");
    // And spends no request doing it.
    expect(calls).toHaveLength(0);
  });

  it("sends no api key when none is configured", async () => {
    const calls = stub({ results: [label()] });
    await fetchLabel("atorvastatin");
    expect(calls[0]).not.toContain("api_key");
    // openFDA is open; a key only raises the rate limit.
    expect(calls[0]).toContain("api.fda.gov/drug/label.json");
  });
});

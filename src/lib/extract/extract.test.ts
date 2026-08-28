/**
 * Step 6: free text to structured fields, with the same discipline as the
 * assessment — and step 7's guarantee, that the model fills fields and
 * `caseValidity` decides what they add up to.
 */
import { describe, expect, it } from "vitest";
import {
  caseValidity,
  flaggedCriteria,
  spanMatchesNarrative,
  CaseReference,
} from "@/lib/schemas";
import { EMPTY_SLOTS, advance, startConversation } from "@/lib/intake/conversation";
import { intakeToCase } from "@/lib/intake/to-case";
import { messagesOf, type AiBinding } from "@/lib/assess/ai";
import { extractReport } from "./extract";
import { verifyExtraction, parseExtraction } from "./verify";
import type { RawExtraction } from "./schema";

const REPORT =
  "My mother is 71. She started Hepalex for blood pressure on 2026-03-04, two tablets a day by mouth. After about a week she went very yellow and was kept in overnight at the Royal Infirmary. She is getting better now.";

const GOOD = JSON.stringify({
  suspectDrug: "Hepalex",
  reaction: "went very yellow",
  dose: "two tablets a day",
  route: "oral",
  patientAgeYears: 71,
  patientSex: "female",
  therapyStart: "2026-03-04",
  therapyEnd: null,
  reactionOnset: null,
  outcome: "recovering",
  seriousness: [
    { criterion: "hospitalisation", phrase: "was kept in overnight" },
  ],
});

function binding(replies: readonly string[]) {
  const calls: string[] = [];
  let n = 0;
  const b: AiBinding = {
    run: (_m, input) => {
      calls.push(messagesOf(input).map((x) => x.content).join("\n"));
      const r = replies[n] ?? replies[replies.length - 1] ?? "";
      n += 1;
      return Promise.resolve({ response: r });
    },
    aiGatewayLogId: "aig-x",
  };
  return { b, calls };
}

const run = (b: AiBinding | null, text = REPORT) =>
  extractReport({
    binding: b,
    unavailableReason: "no model configured",
    gateway: null,
    sourceText: text,
    knownProducts: ["Hepalex", "Covaxil"],
    now: "2026-08-26T10:00:00Z",
  });

describe("what a model reads that a regex cannot", () => {
  it("reads 'was kept in overnight' as a hospitalisation, with the phrase", () => {
    const { b } = binding([GOOD]);
    return run(b).then((out) => {
      expect(out.extraction).not.toBeNull();
      const flags = out.extraction?.seriousness ?? [];
      expect(flags).toHaveLength(1);
      expect(flags[0]?.criterion).toBe("hospitalisation");
      expect(flags[0]?.phrase).toBe("was kept in overnight");
      // The offsets point at those exact words in the submitted text.
      expect(REPORT.slice(flags[0]?.start, flags[0]?.end)).toBe(
        "was kept in overnight",
      );
    });
  });

  it("fills dose, route, dates and outcome, which no pattern in the old path read", async () => {
    const { b } = binding([GOOD]);
    const out = await run(b);
    expect(out.extraction?.dose).toBe("two tablets a day");
    expect(out.extraction?.route).toBe("oral");
    expect(out.extraction?.therapyStart).toBe("2026-03-04");
    expect(out.extraction?.outcome).toBe("recovering");
  });
});

describe("a phrase the reporter never wrote", () => {
  it("fails the whole extraction rather than dropping one flag", async () => {
    // A model inventing the words a patient used is not a model whose other
    // fields should be trusted on the same reply.
    const invented = JSON.parse(GOOD) as RawExtraction;
    const out = await run(
      binding([
        JSON.stringify({
          ...invented,
          seriousness: [
            { criterion: "death", phrase: "she died in hospital" },
          ],
        }),
        JSON.stringify({ ...invented, seriousness: [] }),
      ]).b,
    );
    // The retry supplied a clean reply, so this succeeds — with no death flag.
    expect(out.extraction?.seriousness).toHaveLength(0);
    expect(out.attempts[0]?.kind).toBe("phrase_not_verbatim");
  });

  it("gives up rather than accept an invented phrase twice", async () => {
    const invented = JSON.parse(GOOD) as RawExtraction;
    const bad = JSON.stringify({
      ...invented,
      seriousness: [{ criterion: "death", phrase: "she died in hospital" }],
    });
    const out = await run(binding([bad, bad]).b);
    expect(out.extraction).toBeNull();
    expect(out.unavailableReason).toContain("does not occur in the report");
  });

  it("names the failing check in the retry instruction", async () => {
    const invented = JSON.parse(GOOD) as RawExtraction;
    const bad = JSON.stringify({
      ...invented,
      seriousness: [{ criterion: "death", phrase: "she died in hospital" }],
    });
    const { b, calls } = binding([bad, GOOD]);
    await run(b);
    expect(calls[1]).toContain("YOUR PREVIOUS REPLY WAS REJECTED");
    expect(calls[1]).toContain("does not occur in the report");
  });
});

describe("values outside the domain's vocabulary", () => {
  const verify = (over: Partial<RawExtraction>) =>
    verifyExtraction({
      raw: { ...(JSON.parse(GOOD) as RawExtraction), ...over },
      sourceText: REPORT,
      model: "m",
      gatewayRequestId: null,
      now: "2026-08-26T10:00:00Z",
    });

  it("drops a route the domain does not have rather than guessing", () => {
    const r = verify({ route: "sublingual-ish" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.route).toBeNull();
  });

  it("drops an invented seventh seriousness criterion", () => {
    const r = verify({
      seriousness: [{ criterion: "very_bad_indeed", phrase: "went very yellow" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.seriousness).toHaveLength(0);
  });

  it("drops a date that is not a date", () => {
    const r = verify({ therapyStart: "about a week ago" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.therapyStart).toBeNull();
  });

  it("drops an impossible age", () => {
    const r = verify({ patientAgeYears: 900 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.patientAgeYears).toBeNull();
  });

  it("refuses prose with JSON buried in it", () => {
    expect(parseExtraction('Sure! {"suspectDrug":null}').ok).toBe(false);
  });
});

describe("the fallback path is real", () => {
  it("returns no extraction and no error when there is no model", async () => {
    const out = await run(null);
    expect(out.extraction).toBeNull();
    expect(out.unavailableReason).toBe("no model configured");
    expect(out.attempts).toHaveLength(0);
  });

  it("still structures the report through the regex path", () => {
    // advance() with extraction: null is exactly the old behaviour.
    let state = startConversation();
    state = advance({
      state,
      reply: REPORT,
      corpus: [],
      knownProducts: ["Hepalex"],
      audience: "public",
      extraction: null,
    });
    expect(state.slots.drug).toBe("Hepalex");
    expect(state.slots.sex).toBe("female");
    expect(state.slots.seriousnessEvidence).toHaveLength(0);
  });

  it("shows exactly what the patterns miss, which is the case for this step", () => {
    // "My mother is 71" has no "years old", no "aged", and is not a bare
    // number, so none of AGE_PATTERNS fires and the age is simply lost. The
    // conversation then has to ask for it. Nothing is broken here — this is
    // the honest ceiling of pattern matching on prose, and the reason a model
    // is worth the call.
    let state = startConversation();
    state = advance({
      state,
      reply: REPORT,
      corpus: [],
      knownProducts: ["Hepalex"],
      audience: "public",
      extraction: null,
    });
    expect(state.slots.age).toBeNull();
    // Nor does any keyword see the hospitalisation in "was kept in overnight"
    // as evidence: the old path can only raise it as a bare flag with no
    // phrase, and only because someone happened to put "overnight" in a regex.
    expect(state.slots.seriousnessEvidence).toHaveLength(0);
  });

  it("lets the model win where both have an opinion, and keeps regex where it does not", async () => {
    const { b } = binding([GOOD]);
    const out = await run(b);
    let state = startConversation();
    state = advance({
      state,
      reply: REPORT,
      corpus: [],
      knownProducts: ["Hepalex"],
      audience: "public",
      extraction: out.extraction,
    });
    expect(state.slots.dose).toBe("two tablets a day");
    expect(state.slots.age).toBe(71);
    expect(state.slots.seriousnessEvidence).toHaveLength(1);
  });
});

describe("a narrative flag finally reaches a real case", () => {
  it("produces basis 'narrative' with a span that matches the stored narrative", async () => {
    const { b } = binding([GOOD]);
    const out = await run(b);

    // Build the slots the way the app does — through advance() — so this
    // exercises the real merge rather than a hand-assembled shortcut.
    let state = startConversation();
    state = advance({
      state,
      reply: REPORT,
      corpus: [],
      knownProducts: ["Hepalex"],
      audience: "public",
      extraction: out.extraction,
    });
    const slots = {
      ...state.slots,
      reaction: "went very yellow",
      seriousness: [],
      reporterName: "A Reporter",
      reporterContact: "a@example.org",
    };
    const record = intakeToCase({
      slots,
      reference: CaseReference.parse("SN-2026-000500"),
      receivedAt: "2026-08-26",
      now: "2026-08-26T10:00:00Z",
      ids: {
        caseId: "00000005-0000-4000-8000-000000000001",
        drugId: "00000005-0000-4000-8000-000000000002",
        reactionId: "00000005-0000-4000-8000-000000000003",
      },
    });

    const flag = record.reactions[0]?.seriousness.hospitalisation;
    expect(flag?.basis).toBe("narrative");
    expect(flag?.assertedBy).toBe("model");
    expect(flag?.trigger).not.toBeNull();
    // The guarantee that makes the highlight safe to draw.
    if (flag?.trigger != null) {
      expect(spanMatchesNarrative(record.narrative, flag.trigger)).toBe(true);
    }
    expect(record.drugs[0]?.dose).toBe("two tablets a day");
    expect(record.drugs[0]?.route).toBe("oral");
    expect(record.reactions[0]?.outcome).toBe("recovering");
  });

  it("falls back to a declared flag when the span does not fit the stored narrative", () => {
    // The model read a later message; the offsets point into a string the case
    // does not keep. Recording it as narrative would highlight the wrong words.
    const record = intakeToCase({
      slots: {
        ...EMPTY_SLOTS,
        narrative: "A completely different narrative was stored.",
        drug: "Hepalex",
        reaction: "yellow",
        seriousness: [],
        seriousnessEvidence: [
          { criterion: "hospitalisation", phrase: "was kept in overnight", start: 120, end: 141 },
        ],
      },
      reference: CaseReference.parse("SN-2026-000501"),
      receivedAt: "2026-08-26",
      now: "2026-08-26T10:00:00Z",
      ids: {
        caseId: "00000005-0000-4000-8000-000000000011",
        drugId: "00000005-0000-4000-8000-000000000012",
        reactionId: "00000005-0000-4000-8000-000000000013",
      },
    });
    const flag = record.reactions[0]?.seriousness.hospitalisation;
    expect(flag?.basis).toBe("declared");
    expect(flag?.trigger).toBeNull();
    // Still counted: the criterion is not lost, only its unusable span.
    expect(flaggedCriteria(record.reactions[0]!.seriousness)).toContain(
      "hospitalisation",
    );
  });
});

describe("step 7: the model fills fields, caseValidity decides", () => {
  it("feeds caseValidity and is not fed by it", () => {
    // A case the model structured completely is still judged by the pure
    // function over the fields — there is no 'valid' field for it to set.
    const complete = intakeToCase({
      slots: {
        ...EMPTY_SLOTS,
        narrative: REPORT,
        drug: "Hepalex",
        reaction: "went very yellow",
        age: 71,
        sex: "female",
        seriousness: [],
        reporterName: "A Reporter",
        reporterContact: "a@example.org",
      },
      reference: CaseReference.parse("SN-2026-000502"),
      receivedAt: "2026-08-26",
      now: "2026-08-26T10:00:00Z",
      ids: {
        caseId: "00000005-0000-4000-8000-000000000021",
        drugId: "00000005-0000-4000-8000-000000000022",
        reactionId: "00000005-0000-4000-8000-000000000023",
      },
    });
    expect(caseValidity(complete).isValid).toBe(true);

    const noReporter = intakeToCase({
      slots: {
        ...EMPTY_SLOTS,
        narrative: REPORT,
        drug: "Hepalex",
        reaction: "went very yellow",
        age: 71,
        sex: "female",
        seriousness: [],
      },
      reference: CaseReference.parse("SN-2026-000503"),
      receivedAt: "2026-08-26",
      now: "2026-08-26T10:00:00Z",
      ids: {
        caseId: "00000005-0000-4000-8000-000000000031",
        drugId: "00000005-0000-4000-8000-000000000032",
        reactionId: "00000005-0000-4000-8000-000000000033",
      },
    });
    const validity = caseValidity(noReporter);
    expect(validity.isValid).toBe(false);
    expect(validity.missing).toContain("reporter");
  });
});

describe("who gets the credit when both the reporter and the model said it", () => {
  it("keeps the reporter as the asserter, and adds the model's phrase", () => {
    // `declare` overwrites, so a criterion the reporter declared AND the model
    // read was being re-stamped assertedBy:"model" — quietly taking the
    // assertion away from the person who actually made it.
    const record = intakeToCase({
      slots: {
        ...EMPTY_SLOTS,
        narrative: REPORT,
        drug: "Hepalex",
        reaction: "went very yellow",
        seriousness: ["hospitalisation"],
        seriousnessEvidence: [
          {
            criterion: "hospitalisation",
            phrase: "was kept in overnight",
            start: REPORT.indexOf("was kept in overnight"),
            end: REPORT.indexOf("was kept in overnight") + "was kept in overnight".length,
          },
        ],
      },
      reference: CaseReference.parse("SN-2026-000510"),
      receivedAt: "2026-08-26",
      now: "2026-08-26T10:00:00Z",
      ids: {
        caseId: "00000005-0000-4000-8000-000000000041",
        drugId: "00000005-0000-4000-8000-000000000042",
        reactionId: "00000005-0000-4000-8000-000000000043",
      },
    });
    const flag = record.reactions[0]?.seriousness.hospitalisation;
    expect(flag?.assertedBy).toBe("reporter");
    // The phrase is still kept: it is strictly more than a bare declaration.
    expect(flag?.basis).toBe("narrative");
    expect(flag?.trigger?.quote).toBe("was kept in overnight");
  });

  it("still attributes a criterion only the model found to the model", () => {
    const record = intakeToCase({
      slots: {
        ...EMPTY_SLOTS,
        narrative: REPORT,
        drug: "Hepalex",
        reaction: "went very yellow",
        seriousness: [],
        seriousnessEvidence: [
          {
            criterion: "hospitalisation",
            phrase: "was kept in overnight",
            start: REPORT.indexOf("was kept in overnight"),
            end: REPORT.indexOf("was kept in overnight") + "was kept in overnight".length,
          },
        ],
      },
      reference: CaseReference.parse("SN-2026-000511"),
      receivedAt: "2026-08-26",
      now: "2026-08-26T10:00:00Z",
      ids: {
        caseId: "00000005-0000-4000-8000-000000000051",
        drugId: "00000005-0000-4000-8000-000000000052",
        reactionId: "00000005-0000-4000-8000-000000000053",
      },
    });
    expect(record.reactions[0]?.seriousness.hospitalisation?.assertedBy).toBe("model");
  });
});


describe("a drug the reporter never wrote is a fabrication", () => {
  /*
    This filed a real report against the wrong medicine. The reporter wrote
    "after i had my coronovirus injection i feel dizzy"; the extraction
    prompt lists the products this library holds, and the model answered
    "Covaxil" — a demo product the reporter never mentioned. `suspectDrug` was
    the one model-written field with no grounding check, and it is the field
    that decides which product the entire case is about.
  */
  const verify = (over: Partial<RawExtraction>, sourceText: string) =>
    verifyExtraction({
      raw: { ...(JSON.parse(GOOD) as RawExtraction), seriousness: [], ...over },
      sourceText,
      model: "test-model",
      gatewayRequestId: null,
      now: "2026-08-28T00:00:00.000Z",
    });

  it("drops a suspect drug that does not appear in the reporter's words", () => {
    const out = verify(
      { suspectDrug: "Covaxil", reaction: null },
      "after i had my coronovirus injection i feel dizzy",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.extraction.suspectDrug).toBeNull();
  });

  it("keeps a drug the reporter did write, whatever the casing", () => {
    const out = verify(
      { suspectDrug: "Moderna", reaction: null },
      "i had the moderna injection and felt dizzy",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.extraction.suspectDrug).toBe("Moderna");
  });

  it("drops a reaction the reporter never described", () => {
    const out = verify(
      { suspectDrug: null, reaction: "anaphylaxis" },
      "i felt a bit dizzy afterwards",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.extraction.reaction).toBeNull();
  });

  it("keeps a reaction the reporter did describe", () => {
    const out = verify(
      { suspectDrug: null, reaction: "dizzy" },
      "i felt a bit dizzy afterwards",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.extraction.reaction).toBe("dizzy");
  });
});

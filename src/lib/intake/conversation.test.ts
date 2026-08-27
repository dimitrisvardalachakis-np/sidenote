import { describe, expect, it } from "vitest";
import { ChunkId, DocumentId, type DocumentChunk } from "@/lib/schemas";
import {
  EMPTY_SLOTS,
  advance,
  assessAgainstDocuments,
  extractAge,
  extractDrug,
  extractSeriousness,
  extractSex,
  remainingSlots,
  startConversation,
  type IntakeState,
} from "./conversation";

const DOC = DocumentId.parse("00000001-0000-4000-8000-000000000001");
const PRODUCTS = ["Hepalex", "hepalexin", "Covaxil", "covaxilin", "Dermacil"];

let n = 0;
function chunk(text: string, sourceType: "company" | "public"): DocumentChunk {
  n += 1;
  return {
    id: ChunkId.parse(`${sourceType}#${n}`),
    documentId: DOC,
    sourceType,
    section: "4.8 Undesirable effects",
    ordinal: n,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

const CORPUS: readonly DocumentChunk[] = [
  chunk(
    "Cutaneous reactions including erythema and urticaria were reported in 3% of subjects receiving covaxilin.",
    "company",
  ),
  chunk("Injection site erythema was the most common adverse reaction.", "public"),
  chunk("Jaundice has been reported rarely with hepalexin.", "company"),
];

const step = (state: IntakeState, reply: string) =>
  advance({
    state,
    reply,
    corpus: CORPUS,
    knownProducts: PRODUCTS,
    audience: "public",
  });

const lastAssistant = (state: IntakeState) =>
  [...state.messages].reverse().find((m) => m.role === "assistant")?.text ?? "";

/** The model-only slots, empty. The fallback path leaves every one of these. */
const EMPTY_SLOTS_EXTRAS = {
  dose: null,
  route: null,
  outcome: null,
  therapyStart: null,
  therapyEnd: null,
  reactionOnset: null,
  seriousnessEvidence: [],
} as const;

describe("extraction", () => {
  it("reads ages the way people write them", () => {
    expect(extractAge("she is 45 years old")).toBe(45);
    expect(extractAge("aged 7")).toBe(7);
    expect(extractAge("62yo")).toBe(62);
    expect(extractAge("  38 ")).toBe(38);
  });

  it("does not mistake a dose for an age", () => {
    expect(extractAge("20mg twice a day")).toBeNull();
  });

  it("reads sex from ordinary wording", () => {
    expect(extractSex("my husband")).toBe("male");
    expect(extractSex("she had a rash")).toBe("female");
    expect(extractSex("I would prefer not to say")).toBe("unknown");
    expect(extractSex("the tablets")).toBeNull();
  });

  it("matches a medicine only against known products", () => {
    expect(extractDrug("they were given Hepalex", PRODUCTS)).toBe("Hepalex");
    expect(extractDrug("prescribed by Dr Hepworth", PRODUCTS)).toBeNull();
  });

  it("reads seriousness from plain words", () => {
    expect(extractSeriousness("he was admitted to hospital")).toContain(
      "hospitalisation",
    );
    expect(extractSeriousness("none of those")).toEqual([]);
  });
});

describe("the conversation", () => {
  it("opens by asking what happened", () => {
    const state = startConversation();
    expect(state.pending).toBe("narrative");
    expect(state.messages).toHaveLength(1);
  });

  it("handles the clinician's opening message from the brief", () => {
    // "I have a patient in front of me and have rash on both hands after
    // getting the coronavirus drug."
    const opened = step(
      startConversation(),
      "I have a patient in front of me with a rash on both hands after getting the Covaxil coronavirus drug.",
    );

    // It picked the medicine out, so it must not ask for it again.
    expect(opened.slots.drug).toBe("Covaxil");
    expect(opened.slots.narrative).toContain("rash on both hands");
    // It does not know the reaction term, age or sex yet.
    expect(remainingSlots(opened.slots)).toContain("age");
    expect(remainingSlots(opened.slots)).toContain("sex");
  });

  it("asks for the age and then the sex, as the brief describes", () => {
    let state = step(
      startConversation(),
      "Patient has a rash on both hands after the Covaxil coronavirus drug.",
    );
    state = step(state, "a rash on both hands");
    expect(lastAssistant(state)).toMatch(/how old/i);
    state = step(state, "she is 34");
    expect(state.slots.age).toBe(34);
    // Sex was already readable from "she", so it moves on rather than asking.
    expect(state.slots.sex).toBe("female");
    expect(lastAssistant(state)).toMatch(/hospital|life was in danger/i);
  });

  it("asks again rather than accepting an unusable age", () => {
    let state = step(startConversation(), "rash after Covaxil");
    state = step(state, "a rash");
    const before = state.messages.length;
    state = step(state, "not sure really");
    expect(state.slots.age).toBeNull();
    expect(lastAssistant(state)).toMatch(/number of years/i);
    expect(state.messages.length).toBeGreaterThan(before);
  });

  it("reaches a verdict once everything is collected", () => {
    let state = step(startConversation(), "Rash on both hands after Covaxil.");
    state = step(state, "rash on both hands");
    state = step(state, "34");
    state = step(state, "female");
    state = step(state, "none of those");
    state = step(state, "Dr A Weber");
    state = step(state, "a.weber@example.org");

    expect(state.phase).toBe("complete");
    expect(state.verdict).not.toBeNull();
    expect(remainingSlots(state.slots)).toEqual([]);
  });

  it("ignores an empty reply", () => {
    const state = startConversation();
    expect(step(state, "   ")).toBe(state);
  });

  it("stops accepting input once complete", () => {
    let state = step(startConversation(), "Rash after Covaxil.");
    state = step(state, "rash");
    state = step(state, "34");
    state = step(state, "female");
    state = step(state, "none");
    state = step(state, "A Weber");
    state = step(state, "a@example.org");
    const afterComplete = step(state, "one more thing");
    expect(afterComplete).toBe(state);
  });
});

describe("the grounded verdict", () => {
  const slots = {
    narrative: "rash after the vaccine",
    drug: "covaxilin",
    reaction: "rash on both hands",
    age: 34,
    sex: "female" as const,
    seriousness: [],
    reporterName: "Dr A Weber",
    reporterContact: "a.weber@example.org",
    ...EMPTY_SLOTS_EXTRAS,
  };

  it("finds a reaction the documents do describe, and cites it", () => {
    const verdict = assessAgainstDocuments(slots, CORPUS, "reviewer");
    expect(verdict.alreadyDescribed).toBe(true);
    expect(verdict.companyCitations.length).toBeGreaterThan(0);
    expect(verdict.companyCitations[0]?.quote).toContain("erythema");
  });

  it("keeps company and public citations in their own namespaces", () => {
    const verdict = assessAgainstDocuments(slots, CORPUS, "reviewer");
    expect(
      verdict.companyCitations.every((c) => c.sourceType === "company"),
    ).toBe(true);
    expect(verdict.publicCitations.every((c) => c.sourceType === "public")).toBe(
      true,
    );
  });

  it("reports honestly when nothing describes the reaction", () => {
    const verdict = assessAgainstDocuments(
      { ...slots, reaction: "hair turned green" },
      CORPUS,
      "reviewer",
    );
    expect(verdict.alreadyDescribed).toBe(false);
    expect(verdict.companyCitations).toEqual([]);
    expect(verdict.publicCitations).toEqual([]);
  });

  it("never claims a reaction is known without a passage to show", () => {
    const verdict = assessAgainstDocuments(
      { ...slots, reaction: "hair turned green" },
      CORPUS,
      "reviewer",
    );
    // The guarantee: alreadyDescribed can only be true when citations exist.
    expect(verdict.alreadyDescribed).toBe(
      verdict.companyCitations.length + verdict.publicCitations.length > 0,
    );
  });

  it("NEVER quotes a confidential company document to the public", () => {
    // The public chat has no login. The corpus contains CCDS text. An
    // anonymous reporter must not see it, no matter how well it matches.
    const verdict = assessAgainstDocuments(slots, CORPUS, "public");
    expect(verdict.companyCitations).toEqual([]);
    for (const citation of [
      ...verdict.companyCitations,
      ...verdict.publicCitations,
    ]) {
      expect(citation.sourceType).toBe("public");
    }
  });

  it("still lets a signed-in reviewer see the company passage", () => {
    const asReviewer = assessAgainstDocuments(slots, CORPUS, "reviewer");
    expect(asReviewer.companyCitations.length).toBeGreaterThan(0);
  });

  it("does not leak company text into the public conversation transcript", () => {
    let state = step(startConversation(), "Rash on both hands after Covaxil.");
    state = step(state, "rash on both hands");
    state = step(state, "34");
    state = step(state, "female");
    state = step(state, "none");
    state = step(state, "A Weber");
    state = step(state, "a@example.org");
    const everyCitation = state.messages.flatMap((m) => m.citations);
    expect(everyCitation.every((c) => c.sourceType === "public")).toBe(true);
  });

  it("tells the reporter it is submitted either way", () => {
    let state = step(startConversation(), "Hair turned green after Hepalex.");
    state = step(state, "hair turned green");
    state = step(state, "50");
    state = step(state, "male");
    state = step(state, "none");
    state = step(state, "T Cole");
    state = step(state, "t@example.org");
    expect(lastAssistant(state)).toMatch(/submitting it for review/i);
  });
});

describe("what the public chat is allowed to tell a reporter", () => {
  const say = (reaction: string, drug: string, scope?: ReadonlySet<string> | null) =>
    assessAgainstDocuments(
      { ...EMPTY_SLOTS_EXTRAS, ...EMPTY_SLOTS, reaction, drug, seriousness: [] },
      CORPUS,
      "public",
      (scope ?? null) as never,
    );

  it("does not call a reaction described on the strength of the drug name alone", () => {
    /*
      The bug: the query was `[reaction, drug].join(" ")`, so a chunk that
      mentioned only the medicine's own name scored a hit and the reporter was
      told their reaction "does appear in the published information". Telling
      somebody their novel reaction is already known is the answer most likely
      to make them decide not to bother reporting it.
    */
    const verdict = say("hair turned bright green", "Covaxil");
    expect(verdict.alreadyDescribed).toBe(false);
    expect(verdict.publicCitations).toHaveLength(0);
  });

  it("still says so when the reaction really is described", () => {
    const verdict = say("rash", "Covaxil");
    expect(verdict.alreadyDescribed).toBe(true);
  });

  it("never quotes a company document to an anonymous reporter", () => {
    const verdict = say("rash", "Covaxil");
    expect(verdict.companyCitations).toHaveLength(0);
  });

  it("says nothing at all when no reaction has been given yet", () => {
    const verdict = say("", "Covaxil");
    expect(verdict.alreadyDescribed).toBe(false);
  });
});

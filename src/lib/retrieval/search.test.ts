import { describe, expect, it } from "vitest";
import { DocumentId, ChunkId, type DocumentChunk } from "@/lib/schemas";
import {
  excerpt,
  expandQuery,
  fuseByRank,
  lexicalSearch,
  toCitation,
  tokenise,
} from "./search";

const DOC = DocumentId.parse("00000001-0000-4000-8000-000000000001");

let ordinal = 0;
function chunk(
  text: string,
  sourceType: "company" | "public" = "company",
  section: string | null = null,
): DocumentChunk {
  ordinal += 1;
  return {
    id: ChunkId.parse(`${sourceType}#${ordinal}`),
    documentId: DOC,
    sourceType,
    section,
    ordinal,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

const CORPUS: readonly DocumentChunk[] = [
  chunk(
    "Elevations in hepatic transaminases have been reported. Jaundice has been reported rarely in post-marketing experience.",
    "company",
    "4.8 Undesirable effects",
  ),
  chunk(
    "The most frequently reported adverse reactions are nausea, headache and fatigue.",
    "company",
    "4.8 Undesirable effects",
  ),
  chunk(
    "Severe cutaneous adverse reactions including erythema and urticaria have been observed.",
    "company",
    "4.8 Skin disorders",
  ),
  chunk(
    "Hepatic enzyme elevations were observed in 2% of patients receiving the drug.",
    "public",
    "6 ADVERSE REACTIONS",
  ),
  chunk(
    "The most common adverse reactions were injection site erythema and headache.",
    "public",
    "6 ADVERSE REACTIONS",
  ),
];

describe("tokenise", () => {
  it("drops stopwords and punctuation", () => {
    expect(tokenise("The patient was in the hospital.")).toEqual([
      "patient",
      "hospital",
    ]);
  });

  it("singularises crudely so 'reactions' matches 'reaction'", () => {
    expect(tokenise("reactions")).toEqual(["reaction"]);
    expect(tokenise("elevations")).toEqual(["elevation"]);
  });

  it("does not mangle words ending in double s", () => {
    expect(tokenise("illness")).toEqual(["illness"]);
  });
});

describe("expandQuery", () => {
  it("bridges plain words to clinical ones", () => {
    const expanded = expandQuery("rash");
    expect(expanded).toContain("erythema");
    expect(expanded).toContain("urticaria");
  });

  it("bridges 'yellow' to jaundice", () => {
    expect(expandQuery("yellow skin")).toContain("jaundice");
  });

  it("leaves unknown words alone", () => {
    expect(expandQuery("hepalexin")).toEqual(["hepalexin"]);
  });
});

describe("lexicalSearch", () => {
  it("finds the passage a reporter's plain words point at", () => {
    const hits = lexicalSearch(CORPUS, "yellow skin");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.chunk.text).toContain("Jaundice");
  });

  it("bridges 'rash' to the erythema passage", () => {
    const hits = lexicalSearch(CORPUS, "rash on both hands", {
      sourceType: "company",
    });
    expect(hits[0]?.chunk.text).toContain("erythema");
  });

  it("never mixes the company and public namespaces", () => {
    const company = lexicalSearch(CORPUS, "hepatic", { sourceType: "company" });
    const publicHits = lexicalSearch(CORPUS, "hepatic", { sourceType: "public" });
    expect(company.every((h) => h.chunk.sourceType === "company")).toBe(true);
    expect(publicHits.every((h) => h.chunk.sourceType === "public")).toBe(true);
  });

  it("returns nothing for a reaction no document mentions", () => {
    expect(lexicalSearch(CORPUS, "hair turned green", { minScore: 1.5 })).toEqual(
      [],
    );
  });

  it("reports which terms matched, so a hit can be explained", () => {
    const hits = lexicalSearch(CORPUS, "nausea");
    expect(hits[0]?.matched).toContain("nausea");
  });

  it("is deterministic, including ties", () => {
    const a = lexicalSearch(CORPUS, "adverse reactions");
    const b = lexicalSearch(CORPUS, "adverse reactions");
    expect(a.map((h) => h.chunk.id)).toEqual(b.map((h) => h.chunk.id));
  });

  it("handles an empty corpus and an empty query", () => {
    expect(lexicalSearch([], "rash")).toEqual([]);
    expect(lexicalSearch(CORPUS, "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(lexicalSearch(CORPUS, "reactions", { limit: 1, minScore: 0 })).toHaveLength(1);
  });
});

describe("fuseByRank", () => {
  it("is a no-op ordering with a single ranking", () => {
    const single = lexicalSearch(CORPUS, "hepatic", { minScore: 0 });
    expect(fuseByRank([single]).map((h) => h.chunk.id)).toEqual(
      single.map((h) => h.chunk.id),
    );
  });

  it("rewards a chunk that both rankings agree on", () => {
    const first = lexicalSearch(CORPUS, "hepatic", { minScore: 0, limit: 3 });
    const target = first[1];
    if (target === undefined) throw new Error("need two hits");
    // A second ranking that puts the runner-up first should lift it.
    const second = [target, ...first.filter((h) => h.chunk.id !== target.chunk.id)];
    expect(fuseByRank([first, second])[0]?.chunk.id).toBe(target.chunk.id);
  });

  it("merges the matched terms from both rankings", () => {
    const a = lexicalSearch(CORPUS, "hepatic", { minScore: 0, limit: 1 });
    const b = lexicalSearch(CORPUS, "elevations", { minScore: 0, limit: 1 });
    const fused = fuseByRank([a, b]);
    const merged = fused.find((h) => h.chunk.id === a[0]?.chunk.id);
    expect(merged?.matched.length).toBeGreaterThanOrEqual(1);
  });
});

describe("toCitation", () => {
  it("carries chunk id, source type and section", () => {
    const hit = lexicalSearch(CORPUS, "jaundice")[0];
    if (hit === undefined) throw new Error("expected a hit");
    const citation = toCitation(hit);
    expect(citation.sourceType).toBe("company");
    expect(citation.section).toBe("4.8 Undesirable effects");
    expect(citation.quote.length).toBeGreaterThan(0);
  });
});

describe("excerpt", () => {
  it("returns short text untouched", () => {
    expect(excerpt("Short passage.", ["short"])).toBe("Short passage.");
  });

  it("trims long text and marks the elision", () => {
    const long = `${"filler words here. ".repeat(40)}jaundice was observed. ${"more filler. ".repeat(40)}`;
    const result = excerpt(long, ["jaundice"], 200);
    expect(result.length).toBeLessThan(320);
    expect(result).toContain("…");
  });

  it("centres on the matched term rather than the start", () => {
    const long = `${"alpha beta gamma. ".repeat(30)}jaundice appears here.${" delta. ".repeat(30)}`;
    expect(excerpt(long, ["jaundice"], 160)).toContain("jaundice");
  });
});

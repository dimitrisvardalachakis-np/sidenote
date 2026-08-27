/**
 * The public search answer — the one surface an anonymous visitor reaches that
 * runs a model over documents.
 *
 * It had no test file at all until the dense half was wired in, which is a
 * consequence of it resolving its own environment: there was no way to hand it
 * a model or a vector store. That is now injectable, and these are the claims
 * worth pinning.
 *
 * THE ONE THAT MATTERS MOST is the first: there is no login on this page and
 * the company library holds confidential CCDS text. Dense retrieval adds a
 * second door into the corpus, and a vector index can hold every namespace at
 * once. So the confidentiality boundary is tested against a store that is
 * DELIBERATELY badly behaved, because a well-behaved fake would prove nothing.
 */
import { describe, expect, it } from "vitest";
import {
  ChunkId,
  DocumentId,
  type DocumentChunk,
  type SourceType,
} from "@/lib/schemas";
import { ANSWER_LIMIT, answerPublicQuestion, type AnswerDeps } from "./answer";
import { messagesOf, type AiBinding } from "./ai";
import type { DenseAvailability, VectorMatch } from "@/lib/retrieval/vectors";

const PUBLIC_DOC = DocumentId.parse("0000000f-0000-4000-8000-00000000000a");
const COMPANY_DOC = DocumentId.parse("0000000f-0000-4000-8000-00000000000b");

function chunk(
  ordinal: number,
  text: string,
  documentId = PUBLIC_DOC,
  sourceType: SourceType = "public",
): DocumentChunk {
  return {
    id: ChunkId.parse(`${documentId}#${ordinal}`),
    documentId,
    sourceType,
    section: "6 ADVERSE REACTIONS",
    ordinal,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

/** The public label. Six passages, so the ANSWER_LIMIT cap can be made to bite. */
const PUBLIC_CHUNKS = [
  chunk(0, "Injection site pain was reported in 68% of subjects."),
  chunk(1, "Fatigue was reported in 54% of subjects."),
  chunk(2, "Myalgia was reported in 37% of subjects."),
  chunk(3, "Headache was reported in 41% of subjects."),
  chunk(4, "Pyrexia was reported in 12% of subjects."),
  chunk(5, "Nausea was reported in 9% of subjects."),
];

/** Confidential. Must never reach this page, by any route. */
const COMPANY_CHUNK = chunk(
  0,
  "CONFIDENTIAL: myalgia occurred in 41% in the unpublished pooled analysis.",
  COMPANY_DOC,
  "company",
);

const CORPUS = [...PUBLIC_CHUNKS, COMPANY_CHUNK];

const matchOf = (
  id: ChunkId,
  score: number,
  documentId = PUBLIC_DOC,
  sourceType: SourceType = "public",
): VectorMatch => ({
  id,
  score,
  metadata: { documentId, sourceType, activeSubstance: "covaxilin" },
});

/** A store that returns whatever it is told to, however wrong. */
function fakeDense(
  matches: readonly VectorMatch[],
  over: Partial<DenseAvailability> = {},
): DenseAvailability {
  return {
    embedder: { embed: (texts) => Promise.resolve(texts.map(() => [1, 0, 0])) },
    store: {
      kind: "local",
      upsert: () => Promise.resolve(),
      query: () => Promise.resolve(matches),
    },
    reason: null,
    source: "local",
    ...over,
  };
}

/** Reads the passages out of the prompt and quotes the first sentence verbatim. */
function quotingBinding() {
  const prompts: string[] = [];
  const binding: AiBinding = {
    run: (_model, input) => {
      const user = messagesOf(input).find((m) => m.role === "user")?.content ?? "";
      prompts.push(user);
      const match = /<<<PASSAGE id="([^"]+)"[^\n]*\n([\s\S]*?)\nPASSAGE>>>/.exec(user);
      if (match?.[1] === undefined || match[2] === undefined) {
        return Promise.resolve({
          response: JSON.stringify({
            found: false,
            chunkId: null,
            quotedSpan: null,
            rationale: null,
          }),
        });
      }
      const sentence = /^[^.]+\./.exec(match[2])?.[0] ?? match[2].slice(0, 60);
      return Promise.resolve({
        response: JSON.stringify({
          found: true,
          chunkId: match[1],
          quotedSpan: sentence,
          rationale: "The passage describes the reaction.",
        }),
      });
    },
    aiGatewayLogId: "aig-answer",
  };
  return { binding, prompts };
}

/** A model that finds nothing, whatever it is shown. */
const refusingBinding: AiBinding = {
  run: () =>
    Promise.resolve({
      response: JSON.stringify({
        found: false,
        chunkId: null,
        quotedSpan: null,
        rationale: null,
      }),
    }),
  aiGatewayLogId: "aig-answer",
};

const deps = (
  binding: AiBinding | null,
  dense: DenseAvailability | null,
): AnswerDeps => ({
  ai: { binding, reason: binding === null ? "no model" : null, source: "http" },
  dense,
  gateway: null,
});

const passageIds = (prompt: string): string[] =>
  [...prompt.matchAll(/<<<PASSAGE id="([^"]+)"/g)].map((m) => m[1] ?? "");

describe("the confidentiality boundary", () => {
  /*
    There is no login on this page. The `sourceType` filter is the only thing
    standing between an anonymous visitor and a confidential document, and
    dense retrieval adds a second door into the corpus that the original
    lexical-only code did not have.
  */
  it("never surfaces a company chunk, however confidently the store returns it", async () => {
    const { binding, prompts } = quotingBinding();
    const answer = await answerPublicQuestion(
      "muscle aches",
      CORPUS,
      deps(binding, fakeDense([matchOf(COMPANY_CHUNK.id, 0.99, COMPANY_DOC, "company")])),
    );

    expect(answer.citations.map((c) => c.chunkId)).not.toContain(COMPANY_CHUNK.id);
    expect(answer.hits.every((h) => h.sourceType === "public")).toBe(true);
    // And the confidential text never even reached the prompt.
    expect(prompts.join("")).not.toContain("CONFIDENTIAL");
  });

  it("never surfaces a company chunk the store mislabels as public", async () => {
    // The metadata is a lie. The mirror is the guarantee, not the metadata.
    const { binding } = quotingBinding();
    const answer = await answerPublicQuestion(
      "muscle aches",
      CORPUS,
      deps(binding, fakeDense([matchOf(COMPANY_CHUNK.id, 0.99, PUBLIC_DOC, "public")])),
    );
    expect(answer.citations).toHaveLength(0);
  });
});

describe("the dense half earns its place", () => {
  it("rescues a question the lexical half cannot answer", async () => {
    // "muscle aches" shares no token with "Myalgia was reported…" — this is a
    // pure semantic rescue, and lexical-only returns nothing for it.
    const lexicalOnly = await answerPublicQuestion(
      "muscle aches",
      CORPUS,
      deps(quotingBinding().binding, null),
    );
    expect(lexicalOnly.citations).toHaveLength(0);
    expect(lexicalOnly.reading).toBeNull();

    const hybrid = await answerPublicQuestion(
      "muscle aches",
      CORPUS,
      deps(quotingBinding().binding, fakeDense([matchOf(PUBLIC_CHUNKS[2]!.id, 0.72)])),
    );
    expect(hybrid.citations.map((c) => c.chunkId)).toEqual([PUBLIC_CHUNKS[2]!.id]);
    expect(hybrid.reading?.status).toBe("read");
  });
});

describe("the slice", () => {
  it("never puts more than ANSWER_LIMIT passages in front of the model", async () => {
    /*
      `fuseByRank` applies no limit. With one ranking that was invisible,
      because `lexicalSearch` had already capped itself and the cap was being
      supplied by accident. The dense ranking below is ordered to put the
      chunks lexical MISSES first, which is both what makes the union exceed
      the cap and the case the feature exists for.
    */
    const { binding, prompts } = quotingBinding();
    const missedFirst = [5, 4, 2, 1, 0, 3].map((o, i) =>
      matchOf(PUBLIC_CHUNKS[o]!.id, 0.9 - i * 0.01),
    );

    await answerPublicQuestion(
      "reported in subjects",
      CORPUS,
      deps(binding, fakeDense(missedFirst)),
    );

    expect(passageIds(prompts.at(-1) ?? "")).toHaveLength(ANSWER_LIMIT);
  });

  it("dedupes a passage both halves found", async () => {
    const { binding, prompts } = quotingBinding();
    await answerPublicQuestion(
      "injection site pain",
      CORPUS,
      deps(binding, fakeDense([matchOf(PUBLIC_CHUNKS[0]!.id, 0.9)])),
    );
    const ids = passageIds(prompts.at(-1) ?? "");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the model gates the claim", () => {
  /*
    This is why the dense half is safe HERE and not yet on the intake chat.
    Dense retrieval's new failure mode is a semantically-near but wrong
    passage. On this path a model reads every candidate first and can answer
    `found: false`, so a near-miss becomes "no passage describes this" rather
    than an answer. The intake chat has no model between retrieval and the
    sentence it shows a reporter.
  */
  it("returns nothing_found rather than an answer when the model refuses", async () => {
    const answer = await answerPublicQuestion(
      "muscle aches",
      CORPUS,
      deps(refusingBinding, fakeDense([matchOf(PUBLIC_CHUNKS[4]!.id, 0.61)])),
    );
    expect(answer.reading?.status).toBe("nothing_found");
    // The passages are still returned so the page can show what was searched,
    // but nothing is claimed about them.
    expect(answer.hits.length).toBeGreaterThan(0);
  });
});

describe("degradation is honest", () => {
  it("still answers lexically when the vector store is down", async () => {
    const broken = fakeDense([], {
      store: {
        kind: "local",
        upsert: () => Promise.resolve(),
        query: () => Promise.reject(new Error("522 origin unreachable")),
      },
    });
    const answer = await answerPublicQuestion(
      "injection site pain",
      CORPUS,
      deps(quotingBinding().binding, broken),
    );
    expect(answer.reading?.status).toBe("read");
  });

  it("still answers lexically when the embedder is down", async () => {
    const broken = fakeDense([], {
      embedder: { embed: () => Promise.reject(new Error("count mismatch")) },
    });
    const answer = await answerPublicQuestion(
      "injection site pain",
      CORPUS,
      deps(quotingBinding().binding, broken),
    );
    expect(answer.reading?.status).toBe("read");
  });

  it("reports unavailable, not nothing_found, when no model is configured", async () => {
    // An outage is not a document saying nothing — non-negotiable #5.
    const answer = await answerPublicQuestion(
      "injection site pain",
      CORPUS,
      deps(null, null),
    );
    expect(answer.reading?.status).toBe("unavailable");
  });

  it("spends nothing on a question too short to be one", async () => {
    let embedded = 0;
    const counting = fakeDense([], {
      embedder: {
        embed: (texts) => {
          embedded += 1;
          return Promise.resolve(texts.map(() => [1, 0, 0]));
        },
      },
    });
    const { binding, prompts } = quotingBinding();
    const answer = await answerPublicQuestion("a", CORPUS, deps(binding, counting));
    expect(answer.citations).toHaveLength(0);
    expect(embedded).toBe(0);
    expect(prompts).toHaveLength(0);
  });
});

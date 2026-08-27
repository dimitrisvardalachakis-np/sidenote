/**
 * The fusion seam, exercised end to end through `assessCase`.
 *
 * `dense.test.ts` proves what `denseSearch` does with a match. This file proves
 * what `assessCase` does with a dense RANKING: that it is fused rather than
 * appended, that it is capped, that it can rescue a case lexical retrieval
 * would have reported as silence, and that when it fails nothing about the
 * assessment changes except one honest field on the audit line.
 *
 * WHAT THESE TESTS DO NOT CLAIM
 *
 * The vector store here is a fake that returns the ids it was handed. That is
 * deliberate and it is a real limit worth stating: no offline test can prove
 * that `@cf/baai/bge-base-en-v1.5` actually places "my muscles ached all over"
 * near a sentence containing "myalgia". Only a run against the real model does
 * that, and `npm run embed:seed` plus a live assessment is how it gets checked.
 *
 * What IS proved offline is everything downstream of that assumption: that a
 * dense-only hit reaches the model as a passage, becomes a citation, and turns
 * a `no_result` into a `grounded` finding. If bge does its job, this is the
 * machinery that carries the result. If it does not, this machinery is exactly
 * what degrades to today's behaviour.
 *
 * A NOTE ON THE THREE GAPS THE PLAN NAMED. Of the three reporter phrasings the
 * design cited as unreachable by the synonym table, only "my muscles ached all
 * over" → **myalgia** returns nothing lexically against the seeded corpus. The
 * other two return a chunk by coincidence: the CCDS paragraph holding
 * "paraesthesia" also says "the hands and forearms", so "pins and needles in my
 * hands" matches on `hand`, and "my throat closed up after the injection"
 * matches on `injection`. Those are worse than a miss in one way — the excerpt
 * centres on the coincidental term, so the reviewer is shown a sentence about
 * cutaneous reactions rather than the nervous-system line that mattered — but
 * they are not the clean "lexical finds nothing" case, so the proof below uses
 * the one that is.
 */
import { describe, expect, it } from "vitest";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { ChunkId, DocumentId, DrugId, type SuspectDrug } from "@/lib/schemas";
import { lexicalSearch } from "@/lib/retrieval/search";
import { DENSE_LIMIT } from "@/lib/retrieval/thresholds";
import { ASSESS_LIMIT, ASSESS_MIN_SCORE, assessCase } from "./assess";
import { documentsForDrug } from "./scope";
import { messagesOf, type AiBinding } from "./ai";
import type { DenseAvailability, VectorMatch } from "@/lib/retrieval/vectors";

const COVAXIL: SuspectDrug = {
  id: DrugId.parse("00000002-0000-4000-8000-000000000001"),
  reportedName: "Covaxil",
  activeSubstance: "covaxilin",
  role: "suspect",
  marketingStatus: "marketed",
  dose: null,
  route: null,
  indication: null,
  therapyStart: null,
  therapyEnd: null,
  dechallenge: null,
  rechallenge: null,
};

const COVAXIL_LABEL = DocumentId.parse("0000000f-0000-4000-8000-000000000001");
const COVAXIL_CCDS = DocumentId.parse("0000000f-0000-4000-8000-000000000002");
const HEPALEX_CCDS = DocumentId.parse("0000000f-0000-4000-8000-000000000004");

/** The public-label passage that names myalgia. Lexical retrieval never finds it. */
const MYALGIA = ChunkId.parse("0000000f-0000-4000-8000-000000000001#4");
/** A Hepalex passage. In the index, never in a Covaxil case's evidence. */
const OTHER_PRODUCT = ChunkId.parse("0000000f-0000-4000-8000-000000000004#0");

/** The phrase a reporter uses. The label says "myalgia" and never says this. */
const REPORTER_WORDS = "my muscles ached all over";

const SUBSTANCE = (id: DocumentId) =>
  SEED_DOCUMENTS.find((d) => d.id === id)?.activeSubstance ?? "unknown";

function matchOf(id: ChunkId, score: number): VectorMatch {
  const documentId = DocumentId.parse(id.slice(0, id.indexOf("#")));
  return {
    id,
    score,
    metadata: {
      documentId,
      sourceType:
        SEED_DOCUMENTS.find((d) => d.id === documentId)?.sourceType ?? "public",
      activeSubstance: SUBSTANCE(documentId),
    },
  };
}

/**
 * A dense half whose store returns exactly what a test hands it.
 *
 * `embeds` counts embedding calls, because "one embedding per case, not one per
 * namespace" is a claim with a cost attached and it needs a test that would
 * notice it regressing.
 */
function fakeDense(
  matches: readonly VectorMatch[],
  over: Partial<DenseAvailability> = {},
) {
  const counter = { embeds: 0, queries: 0 };
  const dense: DenseAvailability = {
    embedder: {
      embed: (texts) => {
        counter.embeds += 1;
        return Promise.resolve(texts.map(() => [1, 0, 0]));
      },
    },
    store: {
      kind: "local",
      upsert: () => Promise.resolve(),
      query: () => {
        counter.queries += 1;
        return Promise.resolve(matches);
      },
    },
    reason: null,
    source: "local",
    ...over,
  };
  return { dense, counter };
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
    aiGatewayLogId: "aig-hybrid",
  };
  return { binding, prompts };
}

const base = {
  chunks: SEED_CHUNKS,
  documentIds: documentsForDrug(SEED_DOCUMENTS, COVAXIL),
  drugName: "Covaxil",
  documentKind: "ccds" as const,
  labelSetId: "spl-1",
  gateway: null,
  now: "2026-08-27T10:00:00Z",
  actor: "reviewer-demo",
  target: "SN-2026-000101",
};

/** Every passage id the prompt was given, in the order it was given them. */
function passageIds(prompt: string): string[] {
  return [...prompt.matchAll(/<<<PASSAGE id="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("the gap this feature exists to close", () => {
  it("finds nothing lexically for the reporter's own words", () => {
    // The premise, asserted rather than assumed. If somebody later adds a
    // `muscle → myalgia` row to the synonym table, this fails loudly and the
    // test below stops proving anything — which is the point of asserting it.
    const scope = SEED_CHUNKS.filter(
      (c) => c.sourceType === "public" && c.documentId === COVAXIL_LABEL,
    );
    const hits = lexicalSearch(scope, REPORTER_WORDS, {
      sourceType: "public",
      limit: ASSESS_LIMIT,
      minScore: ASSESS_MIN_SCORE,
    });
    expect(hits).toHaveLength(0);
  });

  it("reports no_result when only the lexical half runs", async () => {
    // Today's behaviour, which a reviewer reads as "the label does not describe
    // this". It is the failure the whole plan is about: silent, and it looks
    // like a finding.
    const { binding } = quotingBinding();
    const out = await assessCase({
      ...base,
      reactionTerm: REPORTER_WORDS,
      ai: { binding, reason: null, source: "http" as const },
    });
    expect(out.expectedness.state).toBe("no_result");
  });

  it("rescues the case to grounded when the dense half supplies the passage", async () => {
    const { binding } = quotingBinding();
    const { dense } = fakeDense([matchOf(MYALGIA, 0.71)]);
    const out = await assessCase({
      ...base,
      reactionTerm: REPORTER_WORDS,
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    expect(out.expectedness.state).toBe("grounded");
    if (out.expectedness.state !== "grounded") return;

    // Cited, and cited to the passage the vector store pointed at.
    expect(out.expectedness.citations.map((c) => c.chunkId)).toEqual([MYALGIA]);
    // And read — the model was actually asked, which it never was before.
    expect(out.expectedness.reading.status).toBe("read");
  });
});

describe("the slice", () => {
  /*
    The bug this test exists to catch is a deletion, not an addition.

    `fuseByRank` applies no limit: it returns every distinct chunk from every
    ranking. With one ranking that was invisible, because `lexicalSearch` had
    already capped itself. With two it is a silent doubling of prompt size on
    every namespace of every case — a cost regression that produces no wrong
    answer and therefore no failing assertion anywhere else.
  */
  it("never puts more than ASSESS_LIMIT passages in front of the model", async () => {
    const query = "injection site pain";
    const scope = SEED_CHUNKS.filter(
      (c) => c.sourceType === "public" && c.documentId === COVAXIL_LABEL,
    );

    /*
      The premise has to be built, not hoped for.

      Both halves cap themselves at five, so a naive "return everything" dense
      ranking overlaps the lexical one and the union lands at exactly five — and
      the slice is a no-op the test cannot see. `DENSE_LIMIT` absorbed the
      overflow. So the dense ranking below is ordered to put the chunks lexical
      MISSES at the top, which is both the case that makes the union exceed the
      cap and the case the feature exists for.
    */
    const lexicalIds = lexicalSearch(scope, query, {
      sourceType: "public",
      limit: ASSESS_LIMIT,
      minScore: ASSESS_MIN_SCORE,
    }).map((h) => h.chunk.id as string);

    const missedFirst = [
      ...scope.filter((c) => !lexicalIds.includes(c.id)),
      ...scope.filter((c) => lexicalIds.includes(c.id)),
    ].map((c, i) => matchOf(ChunkId.parse(c.id), 0.9 - i * 0.01));

    // What the fused union would be, computed here so the assertion below is
    // testing the cap rather than testing that the corpus is small.
    const union = new Set([
      ...lexicalIds,
      ...missedFirst.slice(0, DENSE_LIMIT).map((m) => m.id as string),
    ]);
    expect(union.size).toBeGreaterThan(ASSESS_LIMIT);

    const { binding, prompts } = quotingBinding();
    const { dense } = fakeDense(missedFirst);
    await assessCase({
      ...base,
      reactionTerm: query,
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    expect(passageIds(prompts.at(-1) ?? "")).toHaveLength(ASSESS_LIMIT);
  });

  it("dedupes a passage both halves found, rather than weighting it twice", async () => {
    const { binding, prompts } = quotingBinding();
    // #4 is the top lexical hit for this query as well as the dense one.
    const { dense } = fakeDense([matchOf(MYALGIA, 0.9)]);
    await assessCase({
      ...base,
      reactionTerm: "injection site pain",
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    const ids = passageIds(prompts.at(-1) ?? "");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(MYALGIA);
  });
});

describe("scope survives the new door into retrieval", () => {
  it("never cites another product, however confidently the store returns it", async () => {
    /*
      The Covaxil/Hepalex incident, re-proved at the level a reviewer sees.

      Two independent filters stand between a vector and a citation: `retrieve`
      hands `denseSearch` only the in-scope chunks, and `denseSearch` applies
      the same predicate again when it builds its hydration map. Mutating
      either one alone leaves this test green — it goes red only when BOTH are
      removed, which is the property worth having for the cardinal sin of this
      project and is stated here so nobody reads a single green tick as proof
      that one layer is doing the work.

      Neither layer trusts the store. A vector index can outlive a re-chunking
      and can hold every product at once; the guarantee is the mirror.
    */
    const { binding } = quotingBinding();
    const { dense } = fakeDense([matchOf(OTHER_PRODUCT, 0.99)]);
    const out = await assessCase({
      ...base,
      reactionTerm: REPORTER_WORDS,
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    // Not rescued — correctly. The only passage on offer was out of scope.
    expect(out.listedness.state).toBe("no_result");
    expect(JSON.stringify(out)).not.toContain(HEPALEX_CCDS);
  });
});

describe("one embedding per case", () => {
  it("embeds the query once and asks both namespaces with it", async () => {
    const { binding } = quotingBinding();
    const { dense, counter } = fakeDense([matchOf(MYALGIA, 0.8)]);
    await assessCase({
      ...base,
      reactionTerm: REPORTER_WORDS,
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    // The query is the reaction term and it is identical on both sides, so a
    // second embedding would be one call made twice — paid for on a button a
    // reviewer is waiting at.
    expect(counter.embeds).toBe(1);
    expect(counter.queries).toBe(2);
  });

  it("spends the embedding before the first generation", async () => {
    /*
      Provenance, not performance.

      `aiGatewayLogId` is a mutable field the binding overwrites per call. An
      embedding issued between a generation and the read of that field would
      stamp a reading with the embedding's request id, and the audit line would
      then point at an inference that produced no text. Retrieval finishing
      before generation starts is what makes that impossible.
    */
    const order: string[] = [];
    const { binding: quoting } = quotingBinding();
    const binding: AiBinding = {
      run: (model, input, options) => {
        order.push("generate");
        return quoting.run(model, input, options);
      },
      aiGatewayLogId: "aig-hybrid",
    };
    const { dense } = fakeDense([matchOf(MYALGIA, 0.8)], {
      embedder: {
        embed: (texts) => {
          order.push("embed");
          return Promise.resolve(texts.map(() => [1, 0, 0]));
        },
      },
    });

    await assessCase({
      ...base,
      reactionTerm: "injection site pain",
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    expect(order[0]).toBe("embed");
    expect(order.indexOf("embed")).toBeLessThan(order.indexOf("generate"));
  });
});

describe("a dense failure is a degradation, never a finding", () => {
  it("still grounds the case on lexical hits when the store is down", async () => {
    const { binding } = quotingBinding();
    const { dense } = fakeDense([], {
      store: {
        kind: "local",
        upsert: () => Promise.resolve(),
        query: () => Promise.reject(new Error("522 origin unreachable")),
      },
    });

    const out = await assessCase({
      ...base,
      reactionTerm: "injection site pain",
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });

    // Exactly what it did before the dense half existed. Not an error, not a
    // no_result, and above all not a claim that the label says nothing.
    expect(out.expectedness.state).toBe("grounded");
  });

  it("still grounds the case when the embedder is down", async () => {
    const { binding } = quotingBinding();
    const { dense } = fakeDense([matchOf(MYALGIA, 0.9)], {
      embedder: { embed: () => Promise.reject(new Error("count mismatch")) },
    });

    const out = await assessCase({
      ...base,
      reactionTerm: "injection site pain",
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });
    expect(out.expectedness.state).toBe("grounded");
  });

  it("reports no_result, not source_unavailable, when dense is down and lexical misses", async () => {
    /*
      The state that must NOT move.

      It is tempting to escalate: the dense half failed, so say the source could
      not be checked. That would be wrong and it would be the exact error
      non-negotiable #5 forbids one layer down. The public label WAS retrieved
      and WAS searched — lexically, completely, and it matched nothing.
      `source_unavailable` is reserved for "no document was consulted at all",
      which is a different and much stronger claim. The dense outage belongs on
      the audit line, which is where it goes.
    */
    const { binding } = quotingBinding();
    const { dense } = fakeDense([], {
      store: {
        kind: "local",
        upsert: () => Promise.resolve(),
        query: () => Promise.reject(new Error("522 origin unreachable")),
      },
    });

    const out = await assessCase({
      ...base,
      reactionTerm: REPORTER_WORDS,
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });
    expect(out.expectedness.state).toBe("no_result");
  });
});

describe("the three-state ladder is unchanged", () => {
  it("still says source_unavailable when no document is held, dense hits or not", async () => {
    // Scope with no company document at all. A vector store confidently
    // returning a CCDS chunk must not manufacture a document nobody holds.
    const { binding } = quotingBinding();
    const { dense } = fakeDense([matchOf(ChunkId.parse(`${COVAXIL_CCDS}#1`), 0.99)]);

    const out = await assessCase({
      ...base,
      documentIds: new Set([COVAXIL_LABEL]),
      reactionTerm: REPORTER_WORDS,
      ai: { binding, reason: null, source: "http" as const },
      dense,
    });
    expect(out.listedness.state).toBe("source_unavailable");
  });

  it("behaves exactly as before when dense is omitted", async () => {
    const { binding } = quotingBinding();
    const withOut = await assessCase({
      ...base,
      reactionTerm: "injection site pain",
      ai: { binding, reason: null, source: "http" as const },
    });
    const withNull = await assessCase({
      ...base,
      reactionTerm: "injection site pain",
      ai: { binding, reason: null, source: "http" as const },
      dense: null,
    });
    expect(withOut).toEqual(withNull);
    expect(withOut.expectedness.state).toBe("grounded");
  });
});

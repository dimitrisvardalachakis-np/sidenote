import "server-only";
import { audit } from "@/lib/audit";
import { denseSearch } from "@/lib/retrieval/dense";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import type { DenseAvailability } from "@/lib/retrieval/vectors";
import {
  fuseByRank,
  lexicalSearch,
  toCitation,
  type ScoredChunk,
} from "@/lib/retrieval/search";
import { MATCHED_ANY_TERM } from "@/lib/retrieval/thresholds";
import type {
  Citation,
  DocumentChunk,
  DocumentId,
  ModelReading,
} from "@/lib/schemas";
import {
  resolveAiBinding,
  resolveGateway,
  type AiAvailability,
  type AiGatewayConfig,
} from "./ai";
import { aiEnv } from "./env";
import { readPassages } from "./generate";

/**
 * Ask a question of the public labels, and get an answer grounded in them.
 *
 * This is the same four steps the reviewer's assessment takes — retrieve
 * lexically, retrieve densely, fuse, read — pointed at a question somebody
 * typed instead of at a case record. It reuses `readPassages` rather than
 * reimplementing it, so the verbatim check, the single retry, the
 * recommendation filter and the honest degraded state all apply here exactly
 * as they do on the reviewer screen.
 *
 * PUBLIC NAMESPACE ONLY, and that is a confidentiality boundary rather than a
 * relevance tweak: there is no login on this page and the company library
 * holds CCDS text. The `sourceType` filter is the only thing standing between
 * an anonymous visitor and a confidential document.
 *
 * WHY THE DENSE HALF IS SAFE TO ADD HERE, when it is not yet safe on the
 * intake chat. Dense retrieval's new failure mode is a semantically-near but
 * wrong passage — one that shares no words with the question. On this path a
 * model reads every candidate before anything is claimed, and it can answer
 * `found: false`; a near-miss therefore becomes "no passage describes this"
 * rather than an answer. The intake chat has no model between retrieval and
 * the sentence it shows a reporter, so the same change there would assert a
 * document's contents on the strength of a ranking alone. Same ranking, very
 * different blast radius.
 */
export const ANSWER_LIMIT = 4;

export interface PublicAnswer {
  readonly citations: readonly Citation[];
  /** Null when retrieval found nothing — there was nothing to read. */
  readonly reading: ModelReading | null;
  /** The chunks that were searched, so the caller can name the document. */
  readonly hits: readonly DocumentChunk[];
}

/**
 * Every public document in the corpus, as the dense half's scope.
 *
 * `denseSearch` requires a document-id set because on the reviewer path that
 * set is the wrong-product guarantee. This page has no product to scope to —
 * a visitor may not name a medicine at all — so the honest set is "every
 * public document", and the confidentiality boundary stays where it already
 * was, on `sourceType`.
 *
 * Derived from the corpus rather than passed in, so a company document id
 * structurally cannot appear in it. Combined with `sourceType: "public"` in
 * the search itself, that is two independent locks on the one boundary this
 * page must not cross.
 */
function publicDocumentIds(
  corpus: readonly DocumentChunk[],
): ReadonlySet<DocumentId> {
  const ids = new Set<DocumentId>();
  for (const chunk of corpus) {
    if (chunk.sourceType === "public") ids.add(chunk.documentId);
  }
  return ids;
}

/** The production wiring, kept in one place so a test can bypass it whole. */
async function resolveFromEnv(): Promise<AnswerDeps> {
  const env = await aiEnv();
  const ai = resolveAiBinding(env);
  return { ai, dense: resolveDenseFor(env, ai), gateway: resolveGateway(env) };
}

/**
 * Everything this function needs from the outside world.
 *
 * Optional, and resolved from the environment when omitted — so the page keeps
 * calling with two arguments and nothing about the production path changes.
 * It exists because this function reads its own environment, which is exactly
 * why it had no tests: there was no way to hand it a model or a vector store.
 * A public surface with a confidentiality boundary and no test file is the
 * wrong trade, and `assessCase` already takes its dependencies this way.
 */
export interface AnswerDeps {
  readonly ai: AiAvailability;
  readonly dense: DenseAvailability | null;
  readonly gateway: AiGatewayConfig | null;
}

export async function answerPublicQuestion(
  question: string,
  corpus: readonly DocumentChunk[],
  deps?: AnswerDeps,
  /**
   * The documents this question may be answered from. Null searches every
   * public label, which is only correct when no medicine was named.
   *
   * WHY THIS EXISTS. Retrieval used to run across every public document, which
   * was harmless while the corpus was two synthetic labels and a visitor was
   * browsing. Once a reporter names a medicine and its real FDA label is
   * fetched, it stops being harmless: a live search for "my muscles ached all
   * over" with atorvastatin named returned a passage from the *Covaxil*
   * fixture — another product's label, offered as the answer about theirs.
   * That is the Covaxil/Hepalex incident again, on the one surface where the
   * reader is a member of the public with no expertise to catch it.
   *
   * So scope is a filter applied before the search, exactly as `assessCase`
   * applies it: a wrong-product citation is not a worse hit, it is a different
   * document.
   */
  scope?: ReadonlySet<DocumentId> | null,
): Promise<PublicAnswer> {
  const query = question.trim();
  if (query.length < 2) return { citations: [], reading: null, hits: [] };

  const searchable =
    scope == null
      ? corpus
      : corpus.filter((chunk) => scope.has(chunk.documentId));
  if (searchable.length === 0) return { citations: [], reading: null, hits: [] };

  /*
    Resolved before retrieval now, not after it.

    It used to sit below the early return, because retrieval could not fail and
    needed nothing from the environment. The dense half needs a model to embed
    the question with, so the environment has to be read first — which also
    means an embedding is spent on questions that go on to match nothing. That
    is the cost of the recall this buys and it is not avoidable: the whole
    point is to find passages the lexical half missed, and there is no way to
    know one was missed without looking.
  */
  const resolved = deps ?? (await resolveFromEnv());
  const { ai, dense } = resolved;

  const lexical = lexicalSearch(searchable, query, {
    sourceType: "public",
    limit: ANSWER_LIMIT,
    minScore: MATCHED_ANY_TERM,
  });

  // Never throws. A dense failure leaves this page doing exactly what it did
  // before the ranking existed, and the reason lands on the audit line.
  const semantic =
    dense === null
      ? {
          hits: [] as readonly ScoredChunk[],
          unavailableReason: "semantic retrieval was not configured for this call",
        }
      : await denseSearch({
          dense,
          chunks: searchable,
          query,
          sourceType: "public",
          documentIds: publicDocumentIds(searchable),
          // The same depth as the lexical ranking, deliberately: RRF weights
          // by rank, so a deeper ranking would get more chances to contribute
          // and quietly outweigh the shallower one for no reason anybody chose.
          limit: ANSWER_LIMIT,
        });

  /*
    Fuse, and slice.

    `fuseByRank` applies no limit and no threshold — it returns every distinct
    chunk from every ranking. With one ranking that was invisible, because
    `lexicalSearch` had already capped itself at ANSWER_LIMIT and the cap was
    being supplied by accident. With two, the union can be twice as long and
    every entry of it goes into the prompt as a passage. This line is now the
    only thing supplying the cap, exactly as in assess.ts.

    Lexical first, so its hydrated chunk wins a tie in fuseByRank's
    first-writer-wins — and so a hit that carries real `matched` terms supplies
    the excerpt rather than a semantic hit whose `matched` is legitimately empty.
  */
  const fused = fuseByRank([lexical, semantic.hits]).slice(0, ANSWER_LIMIT);

  if (fused.length === 0) return { citations: [], reading: null, hits: [] };

  const chunks = fused.map((hit) => hit.chunk);

  const { reading, attempts } = await readPassages({
    binding: ai.binding,
    unavailableReason: ai.reason ?? "no model is configured",
    gateway: resolved.gateway,
    /*
      The question goes in where a case's reaction term would.

      It is a member of the public's own words, which is the same kind of text
      the reviewer path passes — and it is sanitised into the prompt by
      `buildUserMessage` like any other untrusted input, so a question shaped
      like an instruction is data here too.
    */
    reactionTerm: query,
    drugName: "the medicine asked about",
    chunks,
    now: new Date().toISOString(),
  });

  audit({
    actor: "public",
    action: "answer_question",
    target: "public_search",
    outcome: reading.status === "unavailable" ? "failure" : "success",
    detail: {
      status: reading.status,
      model: reading.model ?? "none",
      gatewayRequestId: reading.gatewayRequestId ?? "none",
      source: ai.source,
      passages: chunks.length,
      inferences: attempts.length,
      /*
        Which half found the evidence, and whether both halves ran.

        Safe to record: every message these strings can carry comes from
        `FetchJsonError`, whose `.message` is built from the status and the
        endpoint URL only — the request body lives on `.body`, which is never
        read here. So a dense failure reason cannot carry the question.
      */
      retrieval: semantic.unavailableReason === null ? "hybrid" : "lexical",
      lexicalHits: lexical.length,
      denseHits: semantic.hits.length,
      denseUnavailable: semantic.unavailableReason ?? "none",
      // The question itself is NOT logged. It is a member of the public
      // describing a medical event, which makes it personal data, and
      // non-negotiable #9 says never to put that on an audit line.
      questionLength: query.length,
    },
  });

  return { citations: fused.map(toCitation), reading, hits: chunks };
}

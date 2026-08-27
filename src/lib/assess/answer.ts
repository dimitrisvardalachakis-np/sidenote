import "server-only";
import { audit } from "@/lib/audit";
import { fuseByRank, lexicalSearch, toCitation } from "@/lib/retrieval/search";
import { MATCHED_ANY_TERM } from "@/lib/retrieval/thresholds";
import type { Citation, DocumentChunk, ModelReading } from "@/lib/schemas";
import { resolveAiBinding, resolveGateway } from "./ai";
import { aiEnv } from "./env";
import { readPassages } from "./generate";

/**
 * Ask a question of the public labels, and get an answer grounded in them.
 *
 * This is the same three steps the reviewer's assessment takes — retrieve,
 * fuse, read — pointed at a question somebody typed instead of at a case
 * record. It reuses `readPassages` rather than reimplementing it, so the
 * verbatim check, the single retry, the recommendation filter and the honest
 * degraded state all apply here exactly as they do on the reviewer screen.
 *
 * PUBLIC NAMESPACE ONLY, and that is a confidentiality boundary rather than a
 * relevance tweak: there is no login on this page and the company library
 * holds CCDS text. The `sourceType` filter is the only thing standing between
 * an anonymous visitor and a confidential document.
 */
export const ANSWER_LIMIT = 4;

export interface PublicAnswer {
  readonly citations: readonly Citation[];
  /** Null when retrieval found nothing — there was nothing to read. */
  readonly reading: ModelReading | null;
  /** The chunks that were searched, so the caller can name the document. */
  readonly hits: readonly DocumentChunk[];
}

export async function answerPublicQuestion(
  question: string,
  corpus: readonly DocumentChunk[],
): Promise<PublicAnswer> {
  const query = question.trim();
  if (query.length < 2) return { citations: [], reading: null, hits: [] };

  const fused = fuseByRank([
    lexicalSearch(corpus, query, {
      sourceType: "public",
      limit: ANSWER_LIMIT,
      minScore: MATCHED_ANY_TERM,
    }),
  ]);

  if (fused.length === 0) return { citations: [], reading: null, hits: [] };

  const env = await aiEnv();
  const ai = resolveAiBinding(env);
  const chunks = fused.map((hit) => hit.chunk);

  const { reading, attempts } = await readPassages({
    binding: ai.binding,
    unavailableReason: ai.reason ?? "no model is configured",
    gateway: resolveGateway(env),
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
      // The question itself is NOT logged. It is a member of the public
      // describing a medical event, which makes it personal data, and
      // non-negotiable #9 says never to put that on an audit line.
      questionLength: query.length,
    },
  });

  return { citations: fused.map(toCitation), reading, hits: chunks };
}

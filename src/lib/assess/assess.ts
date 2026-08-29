/**
 * Retrieve, fuse, read.
 *
 * Retrieval is hybrid here: `lexicalSearch` (BM25) and `denseSearch` (cosine
 * over embeddings) each produce a ranking, and `fuseByRank` finally gets the
 * two rankings it was written for. Fusion weights by RANK, never by score,
 * which is the whole reason RRF was chosen — a BM25 score of 1.9 and a cosine
 * of 0.72 are not on comparable scales and never will be.
 *
 * The dense half is optional and failure-tolerant by construction. Omit
 * `dense`, disable it, or have it fall over, and this file does exactly what it
 * did before the ranking existed. What it must never do is turn a dense outage
 * into a finding, so the outcome carries the reason and the audit line records
 * it — the same distinction non-negotiable #5 draws for readings, drawn one
 * layer down for retrieval.
 *
 * Generation attaches strictly after fusion and changes nothing about how a
 * passage is found — only what is said about it.
 *
 * The two namespaces are searched and read separately and never merged. They
 * answer different questions, a citation has to state which document it came
 * from, and the case where they diverge is the headline of the case.
 */
import "server-only";
import { audit } from "@/lib/audit";
import {
  fuseByRank,
  lexicalSearch,
  toCitation,
  type ScoredChunk,
} from "@/lib/retrieval/search";
import type {
  DocumentChunk,
  DocumentId,
  ExpectednessFinding,
  GoverningDocumentKind,
  GroundedNarrative,
  ListednessFinding,
  ModelReading,
  SourceType,
} from "@/lib/schemas";
import { DENSE_LIMIT, MATCHED_ANY_TERM } from "@/lib/retrieval/thresholds";
import { denseSearch } from "@/lib/retrieval/dense";
import type { DenseAvailability, Vector } from "@/lib/retrieval/vectors";
import { narratePassages, readPassages } from "./generate";
import type { AiAvailability, AiGatewayConfig } from "./ai";

/**
 * How much of the document to put in front of the model.
 *
 * Five passages rather than the two the public chat uses: the reviewer screen
 * is the place where missing the right paragraph is expensive, and the model
 * is being asked which passage is the relevant one, which is a question that
 * needs alternatives to be a question at all.
 */
export const ASSESS_LIMIT = 5;

/**
 * The relevance floor, named once in the retrieval module.
 *
 * It used to be 1.0, tuned against the whole 14-chunk corpus, where it was
 * also doing the product-relevance job badly. Scoping does that structurally
 * now, and shrinks the corpus enough that an absolute floor from the larger
 * one discards real hits — see thresholds.ts.
 */
export const ASSESS_MIN_SCORE = MATCHED_ANY_TERM;

export interface AssessInput {
  /** The whole corpus. Namespaces are separated here, not by the caller. */
  readonly chunks: readonly DocumentChunk[];
  /**
   * The documents held for THIS case's product. Retrieval never leaves this
   * set — see scope.ts for why this is a filter and not a ranking signal.
   */
  readonly documentIds: ReadonlySet<DocumentId>;
  readonly reactionTerm: string;
  readonly drugName: string;
  readonly documentKind: GoverningDocumentKind;
  readonly labelSetId: string | null;
  readonly ai: AiAvailability;
  readonly gateway: AiGatewayConfig | null;
  /**
   * The dense half of retrieval. Optional, and that is a decision.
   *
   * Optional rather than `DenseAvailability | null` because omitting it has to
   * be a legitimate way to call this function: every existing caller and test
   * that asks for a lexical assessment stays correct without being rewritten,
   * and a new caller that forgets to pass it degrades to what the system did
   * before rather than crashing. `exactOptionalPropertyTypes` is on, so the
   * union spells out all three of absent, explicitly null, and present.
   */
  readonly dense?: DenseAvailability | null | undefined;
  /** Injected so the result is reproducible in a test. */
  readonly now: string;
  /** Audit fields. Who asked, and which case this was for. */
  readonly actor: string;
  readonly target: string;
}

export interface AssessOutput {
  readonly listedness: ListednessFinding;
  readonly expectedness: ExpectednessFinding;
}

/**
 * The query is the reaction, and only the reaction.
 *
 * The drug name used to be appended, from when retrieval searched the whole
 * corpus and needed some pull towards the right product. Scoping made that
 * redundant, and then worse than redundant: inside a corpus that is already
 * only this product's documents, the drug name matches nearly every chunk. It
 * stopped being a relevance signal and became a guaranteed floor, so a
 * reaction with no overlap at all still came back `grounded` with a citation
 * — the CCDS cover page, offered as evidence about a symptom it never
 * mentions. That also made `no_result` almost unreachable, quietly deleting a
 * state the whole design depends on being distinguishable.
 *
 * Scope answers "which product". The query answers "which passage". Keeping
 * those separate is what lets "no passage matched" mean something again.
 */
function queryFor(input: AssessInput): string {
  return input.reactionTerm;
}

/**
 * True when the corpus holds no document for this namespace at all.
 *
 * The distinction matters more than it looks. `lexicalSearch` returns the same
 * empty array when a real search matched nothing and when there was nothing to
 * search, and collapsing the two would tell a reviewer that the Company Core
 * Data Sheet "appears not to describe the reaction" when no CCDS was ever
 * consulted. That is a positive claim of silence about a document nobody
 * opened — the exact failure non-negotiable #8 exists to prevent, and the
 * reason `source_unavailable` is a state.
 */
function namespaceIsEmpty(
  input: AssessInput,
  sourceType: SourceType,
): boolean {
  return inScope(input, sourceType).length === 0;
}

/** This case's own documents, in one namespace. The only citable set. */
function inScope(
  input: AssessInput,
  sourceType: SourceType,
): readonly DocumentChunk[] {
  return input.chunks.filter(
    (chunk) =>
      chunk.sourceType === sourceType && input.documentIds.has(chunk.documentId),
  );
}

interface RetrievalOutcome {
  readonly hits: readonly ScoredChunk[];
  readonly lexicalCount: number;
  readonly denseCount: number;
  /** Null when the dense half ran. A sentence naming why not, otherwise. */
  readonly denseUnavailable: string | null;
}

async function retrieve(
  input: AssessInput,
  sourceType: SourceType,
  queryVector: Vector | null,
): Promise<RetrievalOutcome> {
  const scope = inScope(input, sourceType);

  const lexical = lexicalSearch(scope, queryFor(input), {
    sourceType,
    limit: ASSESS_LIMIT,
    minScore: ASSESS_MIN_SCORE,
  });

  const dense =
    input.dense == null
      ? {
          hits: [] as readonly ScoredChunk[],
          unavailableReason: "semantic retrieval was not configured for this call",
        }
      : await denseSearch({
          dense: input.dense,
          chunks: scope,
          query: queryFor(input),
          sourceType,
          documentIds: input.documentIds,
          limit: DENSE_LIMIT,
          queryVector,
        });

  /*
    The RRF seam, finally given the second ranking it was written for — and
    the slice that has to come with it.

    `fuseByRank` applies no limit and no threshold: it returns every distinct
    chunk from every ranking. With one ranking that was invisible, because
    `lexicalSearch` had already capped itself at ASSESS_LIMIT. With two, a
    fused list can be twice as long, and every entry of it goes into the
    prompt as a passage — double the tokens on every namespace of every case.
    The cap used to be supplied by accident; this line is now the only thing
    supplying it.

    Lexical goes first. Both rankings hydrate from the same array today so
    fuseByRank's first-writer-wins is moot, but it stops being moot the moment
    anything hydrates from elsewhere, and the locally-verified ranking is the
    right one to trust with the chunk object. Note that array order does NOT
    break ties — the final sort tie-breaks on chunk id — so this is a
    convention, not a ranking lever.
  */
  return {
    hits: fuseByRank([lexical, dense.hits]).slice(0, ASSESS_LIMIT),
    lexicalCount: lexical.length,
    denseCount: dense.hits.length,
    denseUnavailable: dense.unavailableReason,
  };
}

/**
 * Embed the query once, for both namespaces.
 *
 * The query is the reaction term and it is identical on the company and public
 * sides, so embedding twice would be one call made twice — and it would double
 * the latency this adds to a button a reviewer is waiting at.
 *
 * It also has to happen BEFORE either `readNamespace`. `aiGatewayLogId` is a
 * mutable property the binding overwrites per call; an embedding interleaved
 * between a generation and the read of that field would stamp a reading with
 * the embedding's id. Retrieval completing entirely before generation begins
 * is what makes that impossible — the same reason the two reads are already
 * sequential rather than concurrent.
 *
 * Returns null on any failure and never throws. `denseSearch` then embeds for
 * itself, or reports honestly that it could not.
 */
async function embedQueryOnce(
  input: AssessInput,
  query: string,
): Promise<Vector | null> {
  const dense = input.dense ?? null;
  if (dense?.embedder == null || query.trim().length === 0) return null;
  try {
    return (await dense.embedder.embed([query]))[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * What one namespace produced: the reading, and the narrative if one was
 * attempted and survived.
 *
 * Two fields rather than a narrative nested inside the reading. They come from
 * two independent inferences with two gateway request ids, and a reading that
 * failed verification twice must not silently take a narrative down with it —
 * nor the reverse. Keeping them apart is what makes the narrative additive.
 */
interface NamespaceReading {
  readonly reading: ModelReading;
  /** Null when no narrative was attempted at all. */
  readonly narrative: GroundedNarrative | null;
}

/**
 * Read one namespace and record what produced the reading.
 *
 * The audit line carries the model name and the gateway request id, so a
 * verdict a reviewer records later can be traced to the exact inference that
 * was in front of them — non-negotiable #9 applied to AI output rather than
 * only to human writes.
 */
async function readNamespace(
  input: AssessInput,
  sourceType: SourceType,
  retrieval: RetrievalOutcome,
): Promise<NamespaceReading> {
  const hits = retrieval.hits;
  const { reading, attempts } = await readPassages({
    binding: input.ai.binding,
    unavailableReason:
      input.ai.reason ?? "no Workers AI binding is configured in this environment",
    gateway: input.gateway,
    reactionTerm: input.reactionTerm,
    drugName: input.drugName,
    chunks: hits.map((hit) => hit.chunk),
    now: input.now,
  });

  audit({
    actor: input.actor,
    action: "generate_reading",
    target: input.target,
    outcome: reading.status === "unavailable" ? "failure" : "success",
    detail: {
      sourceType,
      status: reading.status,
      /*
        The two fields that make a verdict traceable.

        A reviewer rules on what was in front of them. Six months later, when
        somebody asks why a case was called unlisted, "the model said so" is
        not an answer — the question is which model, on which inference, over
        which passages. `model` and `gatewayRequestId` are how that inference
        is found again in the gateway's log, and `citedChunk` is the passage
        the reading actually quoted.
      */
      model: reading.model ?? "none",
      gatewayRequestId: reading.gatewayRequestId ?? "none",
      gateway: input.gateway?.id ?? "none",
      citedChunk: reading.status === "read" ? reading.chunkId : "none",
      passages: hits.length,
      inferences: attempts.length,
      /*
        Which half of retrieval found the evidence, and whether both halves ran.

        `denseUnavailable` is the field that matters most here. Without it, a
        dense outage and a dense search that legitimately matched nothing both
        write `denseHits: 0`, and a reviewer's ruling can no longer be told
        apart from one made while half the retrieval was down. `passages` is
        the fused count after the slice, so it is not `lexicalHits + denseHits`
        — the overlap between the two rankings is exactly what RRF rewards.
      */
      /*
        "hybrid" only when the dense half actually ran.

        Deriving this from whether `dense` was PASSED said "hybrid" for a run
        where the store was disabled and nothing semantic happened — an
        overclaim on the one line that is supposed to let a ruling be traced to
        the retrieval that informed it. `denseUnavailable` being null is the
        only honest test: it is null exactly when the search completed.
      */
      retrieval: retrieval.denseUnavailable === null ? "hybrid" : "lexical",
      lexicalHits: retrieval.lexicalCount,
      denseHits: retrieval.denseCount,
      denseUnavailable: retrieval.denseUnavailable ?? "none",
      vectorSource: input.dense?.source ?? "none",
      // Why a reply was refused, when one was. A rejected quotation is the
      // single most important thing this system can notice about a model.
      rejections:
        attempts
          .map((a) => a.rejection?.kind)
          .filter((k): k is NonNullable<typeof k> => k !== undefined)
          .join(",") || "none",
    },
  });

  /*
    The narrative runs only when the reading is `read`, and the gate is the
    interesting part.

    After `nothing_found` the model has just said no passage describes this
    reaction; a two-point account of those same passages would contradict it on
    the same panel, and the reader would have no way to know which to believe.
    After `unavailable` the model is either unreachable — so a second call
    fails too — or it produced two replies that failed verification, and its
    prose on the same passages is not something to put in front of a reviewer.

    The dependency runs one way only: reading -> narrative, never the reverse.
    Nothing below can change the reading, the citations, or the finding state.
  */
  if (reading.status !== "read") {
    return { reading, narrative: null };
  }

  const narrated = await narratePassages({
    binding: input.ai.binding,
    unavailableReason:
      input.ai.reason ?? "no Workers AI binding is configured in this environment",
    gateway: input.gateway,
    reactionTerm: input.reactionTerm,
    drugName: input.drugName,
    chunks: hits.map((hit) => hit.chunk),
    now: input.now,
  });

  /*
    Its own audit line, not extra fields on the reading's.

    This is a different inference with a different gateway request id. Folding
    it into `generate_reading` would attach one id to two inferences — exactly
    the failure the sequential-call comment above exists to prevent,
    reintroduced one layer up at the logging level.
  */
  audit({
    actor: input.actor,
    action: "generate_narrative",
    target: input.target,
    outcome: narrated.narrative.status === "unavailable" ? "failure" : "success",
    detail: {
      sourceType,
      status: narrated.narrative.status,
      model: narrated.narrative.model ?? "none",
      gatewayRequestId: narrated.narrative.gatewayRequestId ?? "none",
      gateway: input.gateway?.id ?? "none",
      points:
        narrated.narrative.status === "narrated"
          ? narrated.narrative.points.length
          : 0,
      citedChunks:
        narrated.narrative.status === "narrated"
          ? narrated.narrative.points.map((p) => p.chunkId).join(",")
          : "none",
      passages: hits.length,
      inferences: narrated.attempts.length,
      /*
        What the model offered that did not survive, and why. This is the only
        place a dropped point is recorded: it is a fact about the model, not
        about the document, so it belongs on the audit line and not on screen.
      */
      dropped: narrated.dropped.length,
      dropReasons:
        narrated.dropped.map((d) => d.reason).join(",") || "none",
    },
  });

  return { reading, narrative: narrated.narrative };
}

export async function assessCase(input: AssessInput): Promise<AssessOutput> {
  const query = queryFor(input);

  /*
    One embedding, spent before anything else happens. See embedQueryOnce for
    why it is here and not inside each retrieve() call: the query is the same
    on both sides, and it has to land before any generation so it cannot
    overwrite the gateway id a reading is about to be stamped with.
  */
  const queryVector = await embedQueryOnce(input, query);

  const company = await retrieve(input, "company", queryVector);
  const publicSide = await retrieve(input, "public", queryVector);

  /*
    Read one namespace, then the other. Sequentially, and deliberately so.

    `aiGatewayLogId` is a mutable property on the binding that the runtime
    overwrites per call, not a value returned by `run`. Two calls in flight
    against the same binding race on it: whichever resolves second overwrites
    the id the first is about to read, and a reading ends up stamped with the
    other namespace's inference. That would make the audit line point at the
    wrong inference — the one thing the id exists to get right, since a verdict
    has to be traceable to the evidence that informed it.

    The cost is one model call of latency on a screen that already tolerates
    the AI being absent entirely. Correct provenance is worth more.
  */
  const companyReading =
    company.hits.length === 0
      ? null
      : await readNamespace(input, "company", company);
  const publicReading =
    publicSide.hits.length === 0
      ? null
      : await readNamespace(input, "public", publicSide);

  const listedness: ListednessFinding =
    namespaceIsEmpty(input, "company")
      ? {
          state: "source_unavailable",
          documentKind: input.documentKind,
          reason:
            "no company safety document is held for this product, so listedness could not be checked",
          attemptedAt: input.now,
        }
      : company.hits.length === 0 || companyReading === null
      ? {
          state: "no_result",
          documentKind: input.documentKind,
          query,
          retrievedAt: input.now,
        }
      : {
          state: "grounded",
          documentKind: input.documentKind,
          citations: company.hits.map(toCitation),
          reading: companyReading.reading,
          narrative: companyReading.narrative,
          retrievedAt: input.now,
        };

  const expectedness: ExpectednessFinding =
    namespaceIsEmpty(input, "public")
      ? {
          state: "source_unavailable",
          reason:
            "no public label is held for this product, so expectedness could not be checked",
          attemptedAt: input.now,
        }
      : publicSide.hits.length === 0 || publicReading === null
      ? { state: "no_result", query, retrievedAt: input.now }
      : {
          state: "grounded",
          citations: publicSide.hits.map(toCitation),
          reading: publicReading.reading,
          narrative: publicReading.narrative,
          labelSetId: input.labelSetId,
          retrievedAt: input.now,
        };

  return { listedness, expectedness };
}

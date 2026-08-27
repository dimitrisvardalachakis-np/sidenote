/**
 * Retrieve, fuse, read. Two model calls per case, maximum.
 *
 * Retrieval and fusion are untouched: `lexicalSearch` and `fuseByRank` are
 * called exactly as they already were, and `fuseByRank` is still handed one
 * ranking, which is the no-op it has always been until Vectorize supplies a
 * dense second. Generation attaches strictly after fusion and changes nothing
 * about how a passage is found — only what is said about it.
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
  ListednessFinding,
  ModelReading,
  SourceType,
} from "@/lib/schemas";
import { readPassages } from "./generate";
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
 * Just above zero, and that is a deliberate change of job.
 *
 * The threshold used to be 1.0, tuned against the whole 14-chunk corpus, where
 * it was doing two jobs at once: dropping passages that matched nothing, and
 * — badly — keeping other products' documents out. Scoping now does the second
 * job structurally, and it also shrinks the corpus to one product's handful of
 * chunks. BM25 idf falls as the corpus shrinks, so the same genuine hit that
 * scored 1.91 across every company document scores 0.91 within Hepalex's own
 * two, and an absolute threshold calibrated on the larger corpus silently
 * discards it. Measured, not guessed: a real hit in a scoped namespace scores
 * 0.56 to 3.50, and a passage matching no query term scores exactly 0.
 *
 * So the floor now means only "at least one query term matched". Product
 * relevance is the scope's job, and which passage actually describes the
 * reaction is the model's — it has `found: false` for precisely that, and a
 * passage wrongly kept costs a sentence of prompt, while one wrongly dropped
 * cannot be cited at all.
 */
export const ASSESS_MIN_SCORE = 0.01;

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

function queryFor(input: AssessInput): string {
  return [input.reactionTerm, input.drugName].filter((s) => s.length > 0).join(" ");
}

/**
 * True when the corpus holds no document for this namespace at all.
 *
 * The distinction matters more than it looks. `lexicalSearch` returns the same
 * empty array when a real search matched nothing and when there was nothing to
 * search, and collapsing the two would tell a reviewer that the Company Core
 * Data Sheet "appears not to describe the reaction" when no CCDS was ever
 * consulted. That is a positive claim of silence about a document nobody
 * opened — the exact failure non-negotiable #5 exists to prevent, and the
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

function retrieve(
  input: AssessInput,
  sourceType: SourceType,
): readonly ScoredChunk[] {
  const lexical = lexicalSearch(inScope(input, sourceType), queryFor(input), {
    sourceType,
    limit: ASSESS_LIMIT,
    minScore: ASSESS_MIN_SCORE,
  });
  // The RRF seam, called exactly as it already was. One ranking today; when
  // Vectorize lands, a dense ranking joins the array and nothing else changes.
  return fuseByRank([lexical]);
}

/**
 * Read one namespace and record what produced the reading.
 *
 * The audit line carries the model name and the gateway request id, so a
 * verdict a reviewer records later can be traced to the exact inference that
 * was in front of them — non-negotiable #6 applied to AI output rather than
 * only to human writes.
 */
async function readNamespace(
  input: AssessInput,
  sourceType: SourceType,
  hits: readonly ScoredChunk[],
): Promise<ModelReading> {
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
      // Why a reply was refused, when one was. A rejected quotation is the
      // single most important thing this system can notice about a model.
      rejections:
        attempts
          .map((a) => a.rejection?.kind)
          .filter((k): k is NonNullable<typeof k> => k !== undefined)
          .join(",") || "none",
    },
  });

  return reading;
}

export async function assessCase(input: AssessInput): Promise<AssessOutput> {
  const query = queryFor(input);
  const companyHits = retrieve(input, "company");
  const publicHits = retrieve(input, "public");

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
    companyHits.length === 0
      ? null
      : await readNamespace(input, "company", companyHits);
  const publicReading =
    publicHits.length === 0
      ? null
      : await readNamespace(input, "public", publicHits);

  const listedness: ListednessFinding =
    namespaceIsEmpty(input, "company")
      ? {
          state: "source_unavailable",
          documentKind: input.documentKind,
          reason:
            "no company safety document is held for this product, so listedness could not be checked",
          attemptedAt: input.now,
        }
      : companyHits.length === 0 || companyReading === null
      ? {
          state: "no_result",
          documentKind: input.documentKind,
          query,
          retrievedAt: input.now,
        }
      : {
          state: "grounded",
          documentKind: input.documentKind,
          citations: companyHits.map(toCitation),
          reading: companyReading,
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
      : publicHits.length === 0 || publicReading === null
      ? { state: "no_result", query, retrievedAt: input.now }
      : {
          state: "grounded",
          citations: publicHits.map(toCitation),
          reading: publicReading,
          labelSetId: input.labelSetId,
          retrievedAt: input.now,
        };

  return { listedness, expectedness };
}

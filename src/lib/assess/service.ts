import "server-only";
import { audit } from "@/lib/audit";
import { getCloudflareEnv } from "@/lib/platform/env";
import type {
  DocumentChunk,
  ExpectednessFinding,
  ListednessFinding,
} from "@/lib/schemas";
import { assessCase, type AssessInput, type AssessOutput } from "./assess";
import { spanOccursIn } from "./verify";
import {
  ASSESS_ROUTE,
  ASSESS_SECRET_HEADER,
  AssessRequest,
  AssessResponse,
} from "./wire";

/**
 * Where the RAG path runs.
 *
 * Two implementations of one question, resolved the way `resolveAiBinding` and
 * `getCaseCoordination` already resolve theirs: the service binding when it is
 * there, in-process when it is not. The fallback is not a courtesy — `next dev`
 * and vitest have no `services` binding at all, so without it the reviewer
 * screen would only work when deployed, which is the opposite of what a
 * fallback is for.
 *
 * WHY A SEPARATE WORKER AT ALL.
 *
 * The RAG path is the only part of this app that spends money and the only
 * part that is slow. Behind its own Worker it gets its own limits, its own
 * bindings and its own deployment, and the app keeps none of the credentials it
 * uses. `workers_dev: false` on that Worker means the only route to it is the
 * binding — it is not a URL anybody can find.
 *
 * WHAT DOES NOT MOVE. Scope, and the verdict. Which documents belong to this
 * case is decided here, before anything crosses, because retrieval leaving the
 * set held for this product is a safety failure and not a performance one. And
 * nothing over there rules on anything: it returns readings, exactly as the
 * in-process path does, and `ReviewerRuling` is still the only place a
 * determination exists.
 */

export interface AssessService {
  assess(input: AssessInput): Promise<AssessOutput>;
  /** False when this is running in-process, so the audit line can say so. */
  readonly remote: boolean;
}

/** A `services` binding is a Fetcher: same shape as `fetch`, no network hop. */
interface AssessBinding {
  fetch(request: Request): Promise<Response>;
}

function isFetcher(value: unknown): value is AssessBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fetch?: unknown }).fetch === "function"
  );
}

const inProcess: AssessService = {
  remote: false,
  assess: (input) => assessCase(input),
};

/**
 * Every span the far side offers, checked against the chunks we sent it.
 *
 * Non-negotiable #6 says the verbatim check is in code, and it says nothing
 * about which process produced the text. The AI Worker checks its own
 * generations before it answers; this checks them again on arrival, because a
 * service response is data crossing a trust boundary and the only party that
 * can be sure a quotation is real is the one holding the document. The two
 * checks are not redundant — they have different threat models. That one is
 * about a model that fabricates; this one is about a reply that does not match
 * the passages this request was actually about.
 *
 * A finding that fails is discarded whole and reported as unavailable, never
 * trimmed until it passes. An outage is an honest state; a quotation nobody
 * verified is a false statement attributed to a safety document.
 */
function spansHold(
  finding: ListednessFinding | ExpectednessFinding,
  chunks: readonly DocumentChunk[],
): boolean {
  // Only a grounded finding carries a quotation. `no_result` and
  // `source_unavailable` are the two honest states with nothing to check, and
  // they are not the same as each other — see non-negotiable #5.
  if (finding.state !== "grounded") return true;
  if (finding.reading.status !== "read") return true;

  const { chunkId, quotedSpan } = finding.reading;
  const chunk = chunks.find((c) => c.id === chunkId);
  if (chunk === undefined) return false;

  return spanOccursIn(chunk, quotedSpan);
}

class RemoteAssessService implements AssessService {
  readonly remote = true;
  readonly #binding: AssessBinding;
  readonly #secret: string;

  constructor(binding: AssessBinding, secret: string) {
    this.#binding = binding;
    this.#secret = secret;
  }

  async assess(input: AssessInput): Promise<AssessOutput> {
    const body: AssessRequest = {
      chunks: [...input.chunks],
      documentIds: [...input.documentIds],
      reactionTerm: input.reactionTerm,
      drugName: input.drugName,
      documentKind: input.documentKind,
      labelSetId: input.labelSetId,
      now: input.now,
      actor: input.actor,
      target: input.target,
    };

    const response = await this.#binding.fetch(
      // The host is ignored by a service binding — it never leaves the edge —
      // but a Request needs an absolute URL to exist at all.
      new Request(`https://assess.invalid${ASSESS_ROUTE}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ASSESS_SECRET_HEADER]: this.#secret,
        },
        body: JSON.stringify(body),
      }),
    );

    if (!response.ok) {
      throw new Error(`assess worker returned ${String(response.status)}`);
    }

    const parsed = AssessResponse.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("assess worker returned a shape this app cannot render");
    }

    for (const finding of [parsed.data.listedness, parsed.data.expectedness]) {
      if (!spansHold(finding, input.chunks)) {
        throw new Error("assess worker quoted a span that is not in its chunk");
      }
    }

    return parsed.data;
  }
}

/**
 * The binding, or the in-process path, with the reason recorded either way.
 *
 * A missing secret degrades to in-process rather than calling the Worker
 * without one: the far side would refuse it, and an unauthenticated call that
 * fails is strictly worse than a local call that works.
 */
export async function getAssessService(): Promise<AssessService> {
  const bindings = await getCloudflareEnv();
  /*
    Read as a record rather than off `CloudflareEnv`, the same narrowing
    `resolveAiBinding` does with `env["AI"]`. A generated interface is only as
    current as the last `wrangler types` somebody remembered to run, and a
    binding that is genuinely absent under `next dev` should be a null check
    here rather than a compile error there.
  */
  const env: Readonly<Record<string, unknown>> = { ...bindings };
  const binding = env["ASSESS"];
  const secret = env["SIDENOTE_ASSESS_SECRET"];

  if (!isFetcher(binding)) return inProcess;
  if (typeof secret !== "string" || secret.length === 0) {
    audit({
      actor: "system",
      action: "assess_service",
      target: "worker-ai",
      outcome: "failure",
      detail: { reason: "binding_present_but_no_shared_secret" },
    });
    return inProcess;
  }

  return new RemoteAssessService(binding, secret);
}

/**
 * Run the assessment wherever it runs, and never let the seam be the thing
 * that breaks the screen.
 *
 * A remote failure falls back to in-process rather than propagating. That is
 * the same judgement non-negotiable #8 makes about the model itself — AI
 * failure must never block a human write — applied one layer out: a reviewer
 * whose second Worker is down should get a slower assessment, not a broken
 * case screen. The fallback is audited, because a service binding that has
 * quietly stopped working otherwise looks exactly like one that works.
 */
export async function assessThroughService(
  input: AssessInput,
): Promise<AssessOutput> {
  const service = await getAssessService();
  if (!service.remote) return service.assess(input);

  try {
    return await service.assess(input);
  } catch (error) {
    audit({
      actor: input.actor,
      action: "assess_service",
      target: input.target,
      outcome: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
        fellBackTo: "in_process",
      },
    });
    return inProcess.assess(input);
  }
}

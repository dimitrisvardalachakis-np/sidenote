import { assessCase } from "../src/lib/assess/assess";
import { resolveAiBinding, resolveGateway } from "../src/lib/assess/ai";
import { resolveDenseFor } from "../src/lib/retrieval/resolve";
import {
  ASSESS_ROUTE,
  ASSESS_SECRET_HEADER,
  AssessRequest,
  AssessResponse,
} from "../src/lib/assess/wire";

/**
 * The RAG path, in a Worker of its own.
 *
 * Everything that spends money or takes time lives here: retrieval, fusion,
 * and the two generations per case. The app Worker keeps the queue, the
 * screens, the audit trail and the Durable Object that arbitrates a claim, and
 * holds none of the credentials this one uses.
 *
 * NOT REACHABLE EXCEPT THROUGH THE BINDING. `workers_dev: false` in
 * wrangler.jsonc means there is no `*.workers.dev` URL, and the shared secret
 * below means a request that somehow arrives anyway is refused before it is
 * parsed. Two mechanisms rather than one, because the first is a deployment
 * setting somebody can change from a dashboard and the second is in the code.
 *
 * WHAT THIS WORKER IS NOT ALLOWED TO DO. It does not decide anything. It
 * returns readings of passages it was handed, with citations, exactly as the
 * in-process path does — non-negotiable #4 is a property of the system and not
 * of the process boundary, and `ReviewerRuling` is still the only place a
 * determination exists. It also does not choose which documents are in scope:
 * the app sends the chunks, already scoped to the case's product, because
 * retrieval leaving that set is a safety failure and the decision belongs
 * where the case is.
 */

/**
 * Constant-time comparison.
 *
 * A shared secret compared with `===` leaks its length and then its prefix to
 * anything that can time the response. This Worker is not on the public
 * internet, which makes that unlikely rather than impossible, and the cost of
 * being careful is six lines.
 */
function secretMatches(offered: string | null, expected: string): boolean {
  if (offered === null) return false;
  if (offered.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < offered.length; i += 1) {
    difference |= offered.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Named rather than exported anonymously, so a stack trace and the lint rule
 * both have something to call it — the same reason `worker/index.ts` names its
 * handler.
 */
const assessWorker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== ASSESS_ROUTE) {
      return json({ error: "not found" }, 404);
    }

    /*
      The secret is checked before the body is read, deliberately.

      Parsing first would mean an unauthenticated caller could hand this Worker
      a megabyte of JSON and make it do the work of rejecting it. It also keeps
      the failure mode simple: there is exactly one reason a request gets a 401
      and it is never anything about the request's contents.
    */
    /*
      Narrowed once, here. `resolveAiBinding` documents why its parameter is
      `unknown`-valued: a Worker's `env` carries strings AND bindings, and the
      honest way to accept both is to narrow at the boundary rather than to
      claim a shape.
    */
    const settings: Readonly<Record<string, unknown>> = { ...env };

    const expected = settings["SIDENOTE_ASSESS_SECRET"];
    if (typeof expected !== "string" || expected.length === 0) {
      // Refusing everything is the right answer to being misconfigured. A
      // Worker that serves inference to anyone because its secret was not set
      // is worse than one that serves nobody.
      return json({ error: "not configured" }, 503);
    }
    if (!secretMatches(request.headers.get(ASSESS_SECRET_HEADER), expected)) {
      return json({ error: "unauthorized" }, 401);
    }

    const parsed = AssessRequest.safeParse(await request.json());
    if (!parsed.success) {
      return json({ error: "malformed request" }, 400);
    }

    const input = parsed.data;

    /*
      Its own bindings, resolved here.

      This is the reason the split is worth anything: the model access, the
      gateway and the vector store belong to THIS Worker's environment, and the
      app never holds them. `resolveAiBinding` degrades to null with a reason
      exactly as it does in-process, and `assessCase` reports that as
      `source_unavailable` rather than as a document saying nothing.
    */
    const ai = resolveAiBinding(settings);
    const dense = resolveDenseFor(settings, ai);
    const gateway = resolveGateway(settings);

    const output = await assessCase({
      chunks: input.chunks,
      documentIds: new Set(input.documentIds),
      reactionTerm: input.reactionTerm,
      drugName: input.drugName,
      documentKind: input.documentKind,
      labelSetId: input.labelSetId,
      ai,
      gateway,
      dense,
      now: input.now,
      actor: input.actor,
      target: input.target,
    });

    // Parsed on the way out as well as the way in. The caller parses it again
    // on arrival, which is not redundant — this catches a bug in this Worker,
    // that one catches a Worker deployed from a different revision.
    return json(AssessResponse.parse(output), 200);
  },
};

export default assessWorker;

import "server-only";
import { audit } from "@/lib/audit";
import { getCloudflareEnv } from "@/lib/platform/env";
import type { IngestMessage } from "./messages";
import { runStep } from "./steps";

/**
 * The producer: how work gets onto the pipeline.
 *
 * `dispatch` is the only entry point the application uses. It hides one
 * decision — queue or run now — and hides nothing else.
 *
 * WHEN THERE IS NO QUEUE, THE WORK STILL HAPPENS.
 *
 * Running inline is the honest fallback rather than dropping the message,
 * because the alternative is a `next dev` where uploading a document appears
 * to succeed and the document is never chunked. The difference is visible
 * where it matters: inline work happens in the request, so the reviewer waits
 * for it, and there are no retries and no dead-letter queue. That is a slower,
 * less resilient pipeline — not a missing one.
 *
 * The one thing inline mode does NOT do is pretend. Every inline run is
 * audited, so a deployed environment quietly missing its queue binding shows
 * up in the log rather than as a mysteriously slow upload.
 */

export type DispatchMode = "queued" | "inline";

async function queueBinding(): Promise<Queue<unknown> | null> {
  const env = await getCloudflareEnv();
  return env?.INGEST_QUEUE ?? null;
}

export async function dispatch(
  message: IngestMessage,
): Promise<DispatchMode> {
  const queue = await queueBinding();

  if (queue !== null) {
    await queue.send(message);
    return "queued";
  }

  audit({
    actor: "system",
    action: "pipeline_inline",
    target: message.kind,
    outcome: "success",
    detail: { reason: "no_queue_binding" },
  });

  await runInline(message);
  return "inline";
}

/**
 * Run a message and everything it leads to, depth first.
 *
 * Bounded by `depth` rather than trusted to terminate. The steps chain
 * chunk → embed and nothing loops today, but an inline pipeline that can
 * recurse is one edit away from hanging a Server Action, and a request that
 * never returns is a much worse bug than a message that does not get processed.
 */
async function runInline(message: IngestMessage, depth = 0): Promise<void> {
  if (depth > 4) {
    audit({
      actor: "system",
      action: "pipeline_inline",
      target: message.kind,
      outcome: "failure",
      detail: { reason: "chain_too_deep" },
    });
    return;
  }

  const followUps = await runStep(message);
  for (const followUp of followUps) {
    await runInline(followUp, depth + 1);
  }
}

/** True when the real queue is bound. Drives what the UI promises. */
export async function pipelineIsAsync(): Promise<boolean> {
  return (await queueBinding()) !== null;
}

export type { IngestMessage };

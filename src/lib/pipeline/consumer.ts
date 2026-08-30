import "server-only";
import { audit } from "@/lib/audit";
import { IngestMessage, MAX_RETRIES } from "./messages";
import { runStep } from "./steps";

/**
 * The queue consumer.
 *
 * ACK AND RETRY ARE PER MESSAGE, NOT PER BATCH.
 *
 * The default — let the handler throw and the whole batch is retried — means
 * one poisoned message drags nine healthy ones back through the pipeline with
 * it, repeatedly. In this pipeline those nine are model calls that cost money
 * and a Vectorize upsert that has already happened. So every message is
 * acked or retried on its own.
 *
 * WHAT GOES TO THE DEAD-LETTER QUEUE, AND WHAT MUST NOT.
 *
 * A message is retried when the failure is plausibly transient — an embedding
 * rate limit, a Vectorize timeout, a D1 hiccup. After `max_retries` the
 * platform moves it to the DLQ, which is a queue somebody has to look at, not
 * a bin.
 *
 * A message whose work can never succeed — a document that no longer exists —
 * is ACKED with an audit line instead of thrown, because retrying it three
 * times and then filling the DLQ with it teaches whoever reads the DLQ to
 * ignore the DLQ. Those cases return normally from their step rather than
 * throwing; see steps.ts.
 */

export async function runQueueBatch(
  batch: MessageBatch<unknown>,
  env: CloudflareEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  // The producer binding, taken from env. A consumer does not get a send
  // method on its batch — the queue it consumes and the queue it produces to
  // are separate objects even when they are the same queue.
  const queue: Queue<unknown> | undefined = env.INGEST_QUEUE;

  for (const message of batch.messages) {
    const parsed = IngestMessage.safeParse(message.body);

    if (!parsed.success) {
      // Malformed messages are never retried. The bytes will not improve, and
      // three more attempts is three more chances to be confusing. Straight to
      // the DLQ, with a line saying why.
      audit({
        actor: "system",
        action: "queue_message_rejected",
        target: batch.queue,
        outcome: "rejected",
        detail: { reason: "schema_mismatch", issues: parsed.error.issues.length },
      });
      message.ack();
      continue;
    }

    try {
      const followUps = await runStep(parsed.data);

      // Follow-ups are enqueued, not run here. A step that ran its own
      // successors would hold the batch open for the whole chain and lose the
      // per-step retry that made them separate messages in the first place.
      for (const followUp of followUps) {
        if (queue === undefined) {
          // Consuming from a queue that is not also bound as a producer. The
          // chain stops here rather than silently ending — a document that was
          // chunked and never embedded is invisible otherwise.
          audit({
            actor: "system",
            action: "queue_followup_dropped",
            target: followUp.kind,
            outcome: "failure",
            detail: { reason: "no_producer_binding" },
          });
          continue;
        }
        await queue.send(followUp);
      }

      message.ack();
    } catch (error) {
      const attempt = message.attempts;
      const willRetry = attempt < MAX_RETRIES;

      audit({
        actor: "system",
        action: "queue_message_failed",
        target: parsed.data.kind,
        outcome: "failure",
        detail: {
          attempt,
          willRetry,
          error: error instanceof Error ? error.message : "unknown",
        },
      });

      // Explicit rather than relying on the throw. `retry()` is what tells the
      // platform to redeliver this ONE message; throwing here would take the
      // rest of the batch with it.
      message.retry();
    }
  }
}

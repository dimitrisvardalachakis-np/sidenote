import { z } from "zod";
import {
  DocumentChunk,
  DocumentId,
  ExpectednessFinding,
  GoverningDocumentKind,
  ListednessFinding,
} from "@/lib/schemas";

/**
 * The contract between the app and the AI Worker.
 *
 * ONE SCHEMA, BOTH SIDES — non-negotiable #2, which says nothing about forms
 * and everything about a boundary that validation has to genuinely cross. This
 * module is imported by the caller in `service.ts` and by the handler in
 * `worker-ai/index.ts`, and both of them parse. A service binding is a network
 * call however much it looks like a function call, and the far side is another
 * deployment that can be older than this one.
 *
 * WHY THE BOUNDARY IS HERE AND NOT AT `assessCase` ITSELF.
 *
 * `AssessInput` carries three things that cannot travel: `ai` is an object with
 * a `run` method, `dense` holds an embedder and a vector store, and `gateway`
 * carries a token that has no business leaving the process that holds it. All
 * three are *capabilities*, and the whole point of moving the RAG path into its
 * own Worker is that the capabilities move with it. So the app sends the
 * question and the passages it has scoped; the AI Worker resolves its own model
 * access from its own bindings.
 *
 * Scope stays on the app's side of the line. Which documents belong to this
 * case is a safety decision — retrieval must never leave the set held for this
 * product — and it is made before anything crosses.
 */

export const ASSESS_ROUTE = "/assess";

/** The header the shared secret travels in. */
export const ASSESS_SECRET_HEADER = "x-sidenote-assess-secret";

export const AssessRequest = z.object({
  /** The corpus, already scoped. The Worker filters namespaces, not products. */
  chunks: z.array(DocumentChunk),
  /** Documents held for THIS case's product; retrieval never leaves the set. */
  documentIds: z.array(DocumentId),
  reactionTerm: z.string().min(1),
  drugName: z.string().min(1),
  documentKind: GoverningDocumentKind,
  labelSetId: z.string().min(1).nullable(),
  /** Injected so a reading is reproducible, exactly as in-process. */
  now: z.iso.datetime(),
  actor: z.string().min(1),
  target: z.string().min(1),
});
export type AssessRequest = z.output<typeof AssessRequest>;

/**
 * What comes back.
 *
 * The two findings, parsed by the same discriminated unions the reviewer
 * screen renders — so a response that does not describe a legal finding is
 * rejected at the boundary rather than stored and drawn. Those schemas already
 * refuse a grounded finding whose reading cites a chunk that was not
 * retrieved; what they cannot check is whether a quoted span occurs in the
 * chunk text, because the text is not in their scope. `service.ts` does that
 * separately, against the chunks it sent.
 */
export const AssessResponse = z.object({
  listedness: ListednessFinding,
  expectedness: ExpectednessFinding,
});
export type AssessResponse = z.output<typeof AssessResponse>;

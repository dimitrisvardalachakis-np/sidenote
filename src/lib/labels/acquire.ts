import "server-only";
/**
 * Getting a public FDA label into the corpus, once.
 *
 * The whole point of this file is that everything downstream stays unchanged.
 * A label fetched from openFDA is chunked by the same chunker, embedded by the
 * same embedder, mirrored into the same library and cited by the same code as
 * a PDF a reviewer uploaded. Retrieval cannot tell them apart, and neither can
 * the verbatim check. One evidence path, one set of guarantees.
 *
 * FETCH ONCE. The library mirror is the cache. A label already held for this
 * substance is never re-fetched, so a busy search page makes no openFDA
 * traffic at all after the first visitor asks about a given medicine — which
 * is what keeps this inside openFDA's unauthenticated rate limit without a
 * key. CLAUDE.md earmarks KV for cached label lookups; the library is standing
 * in for it exactly as the other stores stand in for D1.
 *
 * NEVER THROWS, AND NEVER BLOCKS AN ANSWER. openFDA being slow or down must
 * not stop a reporter getting a reply, so every failure returns an outcome and
 * the surfaces carry on with whatever corpus they already had. That is the
 * same rule non-negotiable #8 applies to the model, applied to a second
 * outside service.
 */
import { audit } from "@/lib/audit";
import { chunkDocument } from "@/lib/ingest/chunk";
import { documentGovernsDrug } from "@/lib/assess/scope";
import { embedAndUpsert } from "@/lib/retrieval/ingest";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { SafetyDocument } from "@/lib/schemas";
import type { DenseAvailability } from "@/lib/retrieval/vectors";
import { fetchLabel, type FetchLabelOptions } from "./openfda";

export type AcquireOutcome =
  /** Already in the library. No network call was made. */
  | { readonly status: "held"; readonly documentId: string }
  /** Fetched, chunked, mirrored, and now searchable. */
  | {
      readonly status: "acquired";
      readonly documentId: string;
      readonly title: string;
      readonly chunks: number;
      readonly embedded: boolean;
    }
  /** openFDA answered and has nothing for this name. A fact, not a failure. */
  | { readonly status: "not_found"; readonly reason: string }
  /** Could not be reached, or could not be stored. */
  | { readonly status: "unavailable"; readonly reason: string };

export interface AcquireInput {
  readonly drugName: string;
  /** Documents already held, so a cached label is never re-fetched. */
  readonly held: readonly SafetyDocument[];
  /** Null disables embedding; the label is still fetched and keyword-searchable. */
  readonly dense: DenseAvailability | null;
  /** Who asked, for the audit line. "public" for an anonymous surface. */
  readonly actor: string;
  readonly options?: FetchLabelOptions | undefined;
}

/**
 * Make sure a public label for this medicine is in the corpus.
 *
 * Returns quickly and without a network call when one is already held, which
 * is the common case after the first ask.
 */
export async function ensurePublicLabel(
  input: AcquireInput,
): Promise<AcquireOutcome> {
  const name = input.drugName.trim();
  if (name.length < 3) {
    return { status: "not_found", reason: "no medicine name was given" };
  }

  /*
    The cache check uses `documentGovernsDrug` — the same predicate retrieval
    uses to decide which documents belong to a case.

    Using anything looser here would fetch a second label for a drug already
    held under a different spelling, and then two public labels would compete
    to answer for one medicine. Using anything stricter would re-fetch on every
    request. Sharing the predicate is what keeps "held" and "retrievable"
    meaning the same thing.
  */
  const alreadyHeld = input.held.find(
    (document) =>
      document.sourceType === "public" &&
      documentGovernsDrug(document, { reportedName: name, activeSubstance: null }),
  );
  if (alreadyHeld !== undefined) {
    return { status: "held", documentId: alreadyHeld.id };
  }

  const outcome = await fetchLabel(name, input.options ?? {});
  if (outcome.status !== "found") {
    audit({
      actor: input.actor,
      action: "fetch_fda_label",
      target: name,
      outcome: outcome.status === "not_found" ? "rejected" : "failure",
      detail: { source: "openfda", reason: outcome.reason },
    });
    return outcome;
  }

  const { document, text } = outcome.label;
  const chunks = chunkDocument(text, {
    documentId: document.id,
    sourceType: "public",
  });

  if (chunks.length === 0) {
    audit({
      actor: input.actor,
      action: "fetch_fda_label",
      target: name,
      outcome: "rejected",
      detail: { source: "openfda", reason: "the label produced no chunks" },
    });
    return {
      status: "not_found",
      reason: `the label for "${name}" produced no readable passages`,
    };
  }

  /*
    Mirror first, embed second — the same ordering the upload path uses, and
    for the same reason: a document in the library but not the index is
    keyword-searchable and honestly labelled, while a document in the index but
    not the library is a vector that can never be hydrated into a citation.
  */
  const chunked = SafetyDocument.parse({
    ...document,
    status: "chunking",
    chunkCount: chunks.length,
  });

  try {
    await getDocumentLibrary().save({ document: chunked, chunks });
  } catch {
    audit({
      actor: input.actor,
      action: "fetch_fda_label",
      target: name,
      outcome: "failure",
      detail: { source: "openfda", reason: "the label could not be stored" },
    });
    return {
      status: "unavailable",
      reason: "the label was fetched but could not be stored",
    };
  }

  const ingest = await embedAndUpsert({
    dense: input.dense,
    document: chunked,
    chunks,
  });

  if (ingest.status === "embedded") {
    await getDocumentLibrary().save({
      document: SafetyDocument.parse({ ...chunked, status: "embedded" }),
      chunks,
    });
  }

  audit({
    actor: input.actor,
    action: "fetch_fda_label",
    target: name,
    outcome: "success",
    detail: {
      source: "openfda",
      documentId: chunked.id,
      // The SPL set id IS the document id, so a citation traces to a public
      // FDA record anyone can look up independently.
      splSetId: chunked.id,
      substance: chunked.activeSubstance,
      effectiveDate: chunked.effectiveDate ?? "none",
      chunks: chunks.length,
      embedding: ingest.status,
      embeddingDetail: ingest.status === "embedded" ? "none" : ingest.reason,
    },
  });

  return {
    status: "acquired",
    documentId: chunked.id,
    title: chunked.title,
    chunks: chunks.length,
    embedded: ingest.status === "embedded",
  };
}

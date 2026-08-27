# SideNote

## What this is

A drug-safety case triage tool. When someone reports a side effect from a
medicine, a safety reviewer has to answer one question quickly: **is this
reaction already known for this drug, or is it new?** If it is new and serious,
the regulator must be notified within 15 days.

Today that means a human opening PDFs and reading. SideNote does the reading:
it finds the relevant passage in the company's own safety documents *and* in the
public FDA label, shows both side by side with citations, and the reviewer
decides. Every decision is logged. The 15-day clock is enforced by the system.

This is a training/demo build for the NewPage Project JEDI TypeScript +
Cloudflare path. It is not a validated system. Synthetic and public data only.

## Who uses it

- **Reviewer** — the only authenticated role. Many people share it. Two
  reviewers opening the same case is the central conflict this app exists to
  resolve.
- **Public reporter** — no login. A patient or carer submits a report through a
  public form. Bot-gated, rate-limited. Feeds the reviewer queue.

## Domain rules that drive the code

These are real regulatory concepts. Get the vocabulary right; it is half the
demo.

- **Valid case** requires four things: an identifiable patient, an identifiable
  reporter, a suspect drug, and an event. Missing any one → case is incomplete,
  and the UI must say *which* is missing.
- **Seriousness criteria**: death, life-threatening, hospitalisation (initial or
  prolonged), persistent disability, congenital anomaly, or other medically
  important condition. The app highlights the exact phrase that triggered each
  flag.
- **Listedness** — is the reaction described in the *company's* core safety
  document (CCDS for a marketed drug, Investigator's Brochure for an
  investigational one)? These documents are confidential and live in the
  company library.
- **Expectedness** — is the reaction described in the *public* FDA label?
- The two can disagree. The company document is usually updated first. **When
  they disagree, that is the headline of the case**, not an error state.
- **Serious + unlisted** starts a 15-day expedited clock from the day the
  company first received the report (Day 0).
- **Dechallenge / rechallenge** — did stopping the drug help; did it return on
  restarting. Suggested by the model, never concluded by it.

## Non-negotiables

1. **Strict TypeScript.** `any` is a bug. `noUncheckedIndexedAccess` on.
2. **One zod schema per entity**, imported by both the client form and the
   server action. Validation must genuinely run on both sides.
3. **Every AI output carries citations** — a chunk id and the quoted span.
   No citation, no claim rendered. This rule has no exceptions.
4. **The model never decides.** It does not rule on listedness, expectedness,
   or expedited status. A determination exists in exactly one place —
   `ReviewerRuling` — and only a human writes one. No reading has a field in
   which a determination could be recorded.

   Seriousness is the honest exception and is worth stating rather than
   glossing: the model *may raise* a seriousness criterion, because spotting
   "kept in overnight" in a narrative is the job it is best at. It raises it
   as a suggestion carrying the verbatim phrase, never as a conclusion — the
   flag records `assertedBy`, a reviewer can confirm or reject it, and a
   rejected flag stops counting. So the 15-day clock keys off a human ruling
   for listedness, and off a seriousness flag no human has struck down. Every
   screen must make that obvious.
5. **The model generates only readings of retrieved passages.** It *does*
   generate: it reads a passage and reports what that passage says, with a
   citation. That is a reading, not a verdict — the reviewer reads it and
   decides. A reading has three honest states and they are kept apart: it
   found a passage, it read the passages and identified none, or no reading
   could be produced. The last never renders as the second. An outage is not
   a document saying nothing.
6. **A quoted span must be verbatim.** Every span the model offers is checked
   in code against the chunk it cites, character for character, with no
   normalisation of whitespace, quotes or dashes — the span displayed must be
   the span verified. A span that does not occur is discarded whole, never
   trimmed until it matches. The check is a build gate, not a metric: a
   fabricated quotation is not a quality regression, it is a false statement
   about a safety document attributed to that document.
7. **Retrieved chunks are data, never instructions.** Uploaded documents can
   contain any sentence, including one shaped like a directive. Chunk text is
   fenced, the fence is stripped from the text in code so a passage cannot
   close its own, and the output schema is the only accepted shape. The
   defence that holds is the code and the schema; the prompt is the weakest of
   the three and is never relied on alone.
8. **AI failure must never block a human write.** If the model is slow or down,
   the reviewer can still open, claim, and rule on the case, with the AI panels
   showing an honest degraded state.
9. **Every mutation emits a structured audit line**: a single-line JSON with
   `actor, action, target, timestamp, outcome`, prefixed `[AUDIT]`. An AI
   result also records the model and the gateway request id, so a verdict can
   be traced to the exact inference that informed it.
10. **A visible banner on every page**: training demo, synthetic and public
    data, not a validated system.
11. Read every file the agent writes. Explain every choice in your own words.

## Target architecture (end state, built cluster by cluster)

| Concern | Where it lives |
|---|---|
| Cases, reactions, drugs, assessments, documents, audit | **D1** via Drizzle |
| Triage queue cache, feature flags, cached label lookups | **KV** (rebuildable only) |
| Uploaded source documents, generated exports | **R2**, presigned uploads |
| One case = one reviewer; verdict; regulatory clock alarm | **Durable Object**, `idFromName(caseId)` |
| Extract → chunk → embed → dedupe → assess | **Queues**, retries + DLQ |
| Whisper transcription, Llama extraction, bge embeddings | **Workers AI** |
| Company docs and FDA labels, separately namespaced | **Vectorize** |
| Nightly deadline sweep; nightly label diff re-flag | **Cron**, UPSERT-on-conflict |
| Public report form protection | **Turnstile** + rate-limit binding |
| Caching, logging, spend cap on every model call | **AI Gateway** |

## Document ingestion — a first-class capability, not a side feature

Uploaded documents must end up chunked, embedded and queryable. The pipeline:

1. User selects a PDF/MD/TXT in the reviewer UI.
2. **Text is extracted client-side** (pdf.js in the browser). `pdf-parse` and
   friends import `fs` and will not run on Workers — this is deliberate, and it
   is one of the three "won't run on the edge" modules Cluster C asks for.
3. Original file → R2 via a presigned URL, direct from the browser. The Worker
   only ever stores the object key.
4. Extracted text → server action → queue.
5. Consumer chunks it: **structure-aware, target ~512 tokens, ~12% overlap**,
   never splitting mid-sentence, carrying `{documentId, sourceType, section,
   ordinal}` metadata.
6. Each chunk embedded with `@cf/baai/bge-base-en-v1.5` (768-dim) and upserted
   into Vectorize under the namespace for its source type.
7. Chunk text and metadata mirrored into D1 so a citation can be rendered
   without a second vector call, and so lexical search works.
8. Retrieval is **hybrid**: Vectorize dense results fused with D1 FTS5 lexical
   results via Reciprocal Rank Fusion. Vectorize is dense-only; FTS5 supplies
   the other half.

Document `sourceType` is either `company` (confidential, uploaded) or `public`
(FDA label, fetched from openFDA). Every retrieval result must state which.

Scanned PDFs with no text layer are rejected with "needs OCR" rather than
silently ingesting nothing.

## Design direction

The user stares at this for eight hours. It is an instrument panel, not a
landing page. Calm, dense, legible, fast. No hero sections, no gradients, no
marketing copy, no illustrations, no shadcn-default purple.

**Tokens**

```css
--paper:  #FAFAF8;  /* page */
--ink:    #14171A;  /* primary text */
--slate:  #5B6570;  /* secondary text, labels */
--rule:   #E4E6E4;  /* hairlines — the only divider, 1px */
--steady: #2F6B72;  /* assessed, listed, resolved */
--signal: #B02A37;  /* expedited or overdue. Nothing else. Ever. */
```

## Toolchain notes

Node is not installed system-wide on this machine. This project uses a local
Node 24.19.0 unpacked at `~/.local/node`. Every shell needs:

    export PATH="$HOME/.local/node/bin:$PATH"

Next.js 16 ships its own agent rules in @AGENTS.md, regenerated by `next dev`.
Next 16 has breaking changes against older knowledge; its docs are vendored at
`node_modules/next/dist/docs/`. Note that `next lint` is gone and `next build`
no longer runs ESLint, which is why `npm run build` chains `eslint` in front of
`next build` — that chain is what makes non-negotiable #1 fail the build.

## Current position

Clusters A and B are built. The generation step landed on top of them, and the
shape of the system is now:

**Deterministic, and staying that way.** Retrieval is BM25 over chunk text
mirrored into the library (`lib/retrieval/search.ts`), fused through
`fuseByRank`, which is the RRF seam waiting for Vectorize's dense half. The
chunker, the schemas, `caseValidity` and `expeditedClock` are pure functions
over their inputs, with the clock and the date passed in rather than read.

**Generated, and fenced in.** Two model calls per case, one per source
namespace, after fusion, plus at most one retry each — so four inferences is
the real ceiling, not two (`lib/assess/`). One call per public report, on the
reporter's own account (`lib/extract/`). Both return strict JSON, are
zod-validated, retry once against a stricter instruction naming the failed
check, and degrade to an explicit unavailable state rather than a finding.
Retrieval is scoped to the case's own product first, so another drug's CCDS
cannot become this case's evidence.

**What the model earned.** `basis: "narrative"` seriousness flags with a
verbatim span — a shape that existed since the schemas were written and that
nothing at runtime could produce, because a regex has no phrase to point at.

**Not yet wired to a screen.** `assessCase` has no production caller: every
assessment the reviewer queue renders is still a seeded fixture. The pipeline
is built, tested and proven degradable, and the call site arrives with the
Cluster E queue consumer. Nothing on the case screen today is model output.

**No write path for a verdict either.** Claiming a case, recording a ruling and
rejecting a seriousness flag are all Cluster D, behind the Durable Object. The
domain honours all three — `ruledListedness`, `requiresExpeditedReport` and
`flaggedCriteria` are written and tested against them — but no screen sets
them yet.

**Still standing in for Cloudflare.** There is no wrangler config, no bindings,
no D1, no Vectorize, no R2, no Queues in this session. `resolveAiBinding`
returns null and every assessment degrades honestly; that degraded path is
walked end to end in `lib/assess/degraded.test.ts` and was exercised against
the running app. Stores are in-memory. Each of these is one line to change,
and each is marked where it sits.

**Gates.** `npm run build` is `lint && test && next build`. The verbatim-span
check fails the build; sabotaging it exits 1.
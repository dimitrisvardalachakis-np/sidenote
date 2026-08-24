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
4. **The model never decides.** It extracts, retrieves, drafts, and cites. The
   reviewer accepts or rejects. Every screen must make that obvious.
5. **AI failure must never block a human write.** If the model is slow or down,
   the reviewer can still open, claim, and rule on the case, with the AI panels
   showing an honest degraded state.
6. **Every mutation emits a structured audit line**: a single-line JSON with
   `actor, action, target, timestamp, outcome`, prefixed `[AUDIT]`.
7. **A visible banner on every page**: training demo, synthetic and public data,
   not a validated system.
8. Read every file the agent writes. Explain every choice in your own words.

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

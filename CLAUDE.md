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

## Running on Cloudflare Workers (Cluster C)

The app is built for Workers by `@opennextjs/cloudflare`, which translates the
Node server `next build` produces into a Worker. Configuration is split in two
on purpose: `open-next.config.ts` is how the app is *built*, `wrangler.jsonc`
is what it is *bound to*.

    npm run build          lint + next build          the Node build, unchanged
    npm run build:worker   lint + opennext build      the Worker bundle
    npm run preview        wrangler dev on the bundle boots it on workerd
    npm run deploy         upload it
    npm run cf-typegen     regenerate worker-configuration.d.ts

Run `cf-typegen` after every change to `wrangler.jsonc`. It writes the binding
types, it is typechecked, and it is excluded from lint only because its
generator emits a blanket `eslint-disable`.

**Secrets.** `TURNSTILE_SITE_KEY` is public and ships in the page's markup;
`TURNSTILE_SECRET_KEY` never leaves the server. Locally both go in `.dev.vars`
(gitignored); deployed, the secret goes in `wrangler secret put`. Neither is
declared as a `var` in `wrangler.jsonc`, because `wrangler types` gives a
declared var a *literal* type and every "is it configured?" check would then be
a comparison the compiler had already decided.

**What is deliberately still missing.** D1, R2, KV and Durable Objects are
Cluster D, so on Workers the three stores fall back to per-isolate memory. That
is announced rather than hidden: every write emits `[AUDIT] ephemeral_write`,
and the banner on every page gains "storage is temporary here, saved work can
be lost". See `src/lib/store/backing.ts`.

### The three modules that will not run on the edge

Two of them ship, and both build cleanly before failing — which is the whole
danger.

1. **`pdfjs-dist`** (standing in for `pdf-parse` and friends, as CLAUDE.md
   says). pdf.js throws `DOMMatrix is not defined` on import outside a browser,
   and `pdf-parse` imports `fs` outright. Handled by extracting text in the
   browser: `src/lib/ingest/pdf-client.ts` is the one deliberately
   non-portable module in `src/lib`, and it loads pdf.js by dynamic import so
   the parser never reaches a server bundle.

2. **`node:fs/promises` and `node:path`**, used by all three stores. Workers has
   no filesystem — not a read-only one, none — but `nodejs_compat` resolves the
   imports happily, so the bundle builds, the Worker boots, and the failure
   arrives the first time somebody saves something. Handled by
   `src/lib/store/backing.ts`: every `node:` import in `src/` is now behind
   `nodeFs()`/`nodePath()`, which throw on Workers rather than letting a caller
   discover the problem at a write.

3. **`jsdom`**, and the `@testing-library` stack that pulls it in. It imports
   `node:fs`, `node:net` and `node:vm`, and it must never reach the shipping
   path at all. Kept out by vitest defaulting to the `node` environment, so a
   component test opts in with a `// @vitest-environment jsdom` docblock rather
   than every module getting a DOM it should not have.

A fourth is worth knowing about even though it is a built-in and not a module:
`Intl.Segmenter` is unevenly available on Workers, which is why `chunk.ts`
detects sentences by hand instead of using the obvious tool.

## Storage (Cluster D)

D1 holds the rows, R2 holds the bytes, KV holds only what can be rebuilt, and
two Durable Objects hold the things that must never be observed in two versions
at once.

    npm run db:generate    drizzle-kit generate    write the next migration
    npm run db:migrate     wrangler d1 apply       against the LOCAL database
    npm run db:migrate:remote                      against the real one

`drizzle.config.ts` never talks to a database — it only diffs `src/lib/db/schema.ts`
against `drizzle/` and writes SQL. Applying is wrangler's job, because wrangler
is what knows which database is meant. `out` in the drizzle config and
`migrations_dir` in `wrangler.jsonc` must stay equal.

**One migration is hand-written.** `drizzle/0001_chunks_fts5.sql` creates the
FTS5 virtual table and the three triggers that keep it in step with `chunks`.
Drizzle cannot express a virtual table, and pretending otherwise in schema.ts
would mean a schema file that does not describe the database. FTS5 is the
lexical half of the hybrid retrieval Cluster E fuses — Vectorize is dense-only.

**What is a column and what is JSON.** A value gets a column when something
sorts or filters by it, and stays JSON when it is a value object read back
whole. So `received_at` is a column and `patient` is not. Seriousness flags stay
JSON for a sharper reason: they carry character offsets into the narrative, and
a schema that invited someone to join on a character offset would eventually get
one. Everything read back is parsed through its zod schema, so a row written by
an older deploy is rejected rather than rendered.

**Two Durable Objects, addressed differently on purpose.**

- `CaseCoordinator`, `idFromName(caseId)` — one instance per case. Holds the
  claim, the ruling and the 15-day alarm. The claim expires after 30 minutes so
  that "one case, one reviewer" does not become "one reviewer, forever".
- `ReferenceMinter`, one instance for the whole app. Fixes the count-then-add
  race in reference generation that has been written down in the code since
  Cluster A step 5 and was never fixable without this.

The alarm and Cluster F's nightly sweep overlap deliberately: the alarm is
precise but only exists if something armed it, and the sweep is coarse but sees
cases whose alarm never was.

**Presigned uploads need credentials the binding cannot give.** `env.DOCUMENTS`
works inside the Worker and cannot be handed to a browser. Presigning is SigV4
against R2's S3 API and needs `R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`,
`R2_S3_ACCOUNT_ID` and `R2_S3_BUCKET`. Without all four the upload falls back to
posting bytes through the Server Action — slower, capped by
`next.config.ts`'s `bodySizeLimit`, and working.

**KV has no `put`.** CLAUDE.md's "(rebuildable only)" is enforced by the API
rather than by a comment: `cached()` takes the function that rebuilds the value,
so there is no way to write a key without saying where it comes from.

## The ingestion pipeline (Cluster E)

Queues carry the work, Workers AI embeds it, Vectorize stores the vectors, and
retrieval fuses dense with lexical.

    wrangler queues create sidenote-ingest
    wrangler queues create sidenote-ingest-dlq
    wrangler vectorize create sidenote-chunks --dimensions=768 --metric=cosine

768 is not a preference — it is the width of `@cf/baai/bge-base-en-v1.5`, and an
index created at another width rejects every upsert.

**Messages carry ids, never payloads.** A Queues message is capped at 128 KB and
the extracted text of a 40-page CCDS is larger, so the text goes to R2 and the
message says where. A message that is *usually* small enough is a pipeline that
works in testing and fails on the document somebody cares about.

**Steps return their follow-ups rather than enqueuing them.** That keeps each
step a function from a message to a list of messages — testable without a queue
binding, and it stops the producer and the steps importing each other. Chunking
and embedding are separate messages because they fail for different reasons:
chunking is pure and deterministic, embedding is a model call that can be rate
limited. Retrying one because the other failed shows up on a bill.

**Not everything goes to the dead-letter queue.** A transient failure is
retried and eventually lands there, which is a queue somebody has to look at.
A message whose work can never succeed — a document that no longer exists — is
acked with an audit line instead, because filling the DLQ with the hopeless
teaches people to ignore the DLQ.

**Dedupe is by content hash.** A CCDS v7.2 is mostly a CCDS v7.1. Identical text
is embedded once however many chunks carry it, which saves the model call and,
more importantly, stops a result list showing the same passage twice — which
reads as two independent pieces of evidence for one claim.

**Retrieval fuses up to three rankings** through the RRF that has been sitting in
`search.ts` since Cluster A: dense from Vectorize, lexical from D1 FTS5, and the
seeded demo corpus in memory. The third exists because the fixtures never went
through the pipeline, so they have no FTS5 rows and no vectors, and without it
the demo would go quiet the moment a database was bound. Each half reports
whether it *ran*, because "found nothing" and "did not happen" are different
facts — the same distinction the assessment schema already draws.

### Two things that only running it would have found

**OpenNext's Cloudflare context is published from `fetch` and nowhere else.**
A queue or cron handler never goes through that path, so `getCloudflareEnv()`
returned null, D1 looked unbound, the case store fell back to memory, the case
was "not found", and the step returned successfully having done nothing —
`QUEUE sidenote-ingest 1/1 (3ms)`. Every layer behaved as designed and the
pipeline was inert. `setAmbientCloudflareEnv()` in `worker/index.ts` is the fix.

**Vectorize and Workers AI have no local emulation**, and binding them made
`initOpenNextCloudflareForDev()` open a *remote* session — so adding those two
bindings broke `next build` for anyone without a `CLOUDFLARE_API_TOKEN`. Hence
`remoteBindings: false` and the `NEXT_PHASE` guard in `next.config.ts`.

The consequence for anyone reading this: **the embedding and Vectorize paths are
written and typechecked but have never executed.** `wrangler dev` reports both
bindings as "not supported" locally. Everything else in this cluster — the
queue, the chunker, D1 mirroring, FTS5, RRF, the assessment write — is verified
on workerd.

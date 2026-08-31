# Giving SideNote an AI brain

Everything in this repository works without a model. Reports are accepted,
cases are triaged, documents are searched, and the evidence panels show real
passages with real citations. What is missing without a model is the *reading*
— the sentence that says what a passage means.

These are the steps to switch that on. They take about ten minutes and none of
them require code changes.

---

## What you are setting up

SideNote calls **Workers AI** with `@cf/meta/llama-3.1-8b-instruct`. There are
two ways to reach it, and the app picks whichever is available:

| | When it applies | What it needs |
|---|---|---|
| **Native binding** | The app is deployed to Cloudflare Workers | An `ai` binding in `wrangler.jsonc` |
| **HTTP (REST)** | Anywhere else — `next dev`, a container, any host | An account id and an API token |

**Start with the HTTP route.** It works on your laptop, needs no deployment,
and is the fastest way to see the system come alive. The native binding is a
later optimisation, not a prerequisite.

---

## Step 1 — Get a Cloudflare account id

1. Sign in at <https://dash.cloudflare.com>. A free account is enough to start;
   Workers AI has a free daily allowance.
2. The account id is in the URL once you are signed in:
   `https://dash.cloudflare.com/`**`<this-long-hex-string>`**`/...`
3. Copy it. It looks like `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`.

## Step 2 — Create an API token

1. Go to **My Profile → API Tokens** (<https://dash.cloudflare.com/profile/api-tokens>).
2. **Create Token → Create Custom Token**.
3. Give it a name, e.g. `sidenote-workers-ai`.
4. Under **Permissions**, add exactly one:
   - `Account` · `Workers AI` · `Read`
5. Under **Account Resources**, select the account from step 1.
6. Create it and **copy the token now** — Cloudflare shows it once.

> Keep this token to the one permission above. It should not be able to do
> anything except run models. If it leaks, revoke it on the same page.

## Step 3 — Put them in `.env.local`

In the project root, create `.env.local`:

```
CLOUDFLARE_ACCOUNT_ID=your-account-id-from-step-1
CLOUDFLARE_API_TOKEN=your-token-from-step-2
```

`.env.local` is already gitignored. **Never commit the token.**

## Signing in as a reviewer

The queue is behind a password. There is **one shared password for the whole
build** — the email address chooses which of three shared identities you are
wearing, and the password decides whether you may wear one at all. That is a
real gate: `/queue`, `/case/*` and `/library` are unreachable without it. It is
not per-person authentication, and the sign-in screen says so rather than
letting a password field imply the stronger claim.

Out of the box, at `/signin`:

| Address | Signs you in as |
|---|---|
| `demo@sidenote.example` | Demo Reviewer |
| `a.okonkwo@sidenote.example` | A. Okonkwo |
| `m.bergstrom@sidenote.example` | M. Bergström |

The default password is `sidenote-demo`. Override it with:

```
SIDENOTE_REVIEWER_PASSWORD=something-else
```

Three identities rather than one because the screen a second reviewer sees when
a case is already claimed is the interaction CLAUDE.md calls the central
conflict this app exists to resolve — and with a single identity it cannot be
reached. Sign in as one, claim a case, sign out, sign in as another.

Attempts are rate limited to ten in five minutes per address, in memory. Like
the other limiters in `src/lib/protection/`, that resets when the server
restarts and counts nothing that happened on another instance.

## Step 4 — Check it worked

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run dev
```

Then:

1. Open <http://localhost:3000/report/search> and ask something like
   `itchy rash on my hands`.
2. You should get a **quoted sentence from the label** above the passages,
   with the document name and a chunk id under it.

If instead you see *"We found passages that may be relevant but could not
summarise them just now"*, the model was not reached. Open a reviewer case at
<http://localhost:3000/queue> — the **Assess this case** button will be greyed
out with the exact reason printed beneath it, naming which variable is missing.

That message is the diagnostic. It will tell you whether the account id is
missing, the token is missing, or the call itself failed.

---

## Step 5 (recommended) — Add an AI Gateway

Not required, but you get caching, a request log, and a spend cap — and
without it, none of those exist.

1. In the dashboard: **AI → AI Gateway → Create Gateway**.
2. Name it, e.g. `sidenote`. Copy the gateway name.
3. Add to `.env.local`:

```
SIDENOTE_AI_GATEWAY_ID=sidenote
```

4. Set a **budget limit** on the gateway in the dashboard. This is the real
   spend cap — the app bounds each request (320 output tokens, at most four
   inferences per assessment), but only the dashboard can cap the account.

5. **If the gateway has Authenticated Gateway switched on**, it needs its own
   credential, separate from the Workers AI token:

```
SIDENOTE_AI_GATEWAY_TOKEN=a-token-with-AI-Gateway-Run
```

   Create it the same way as step 2, with the permission `Account` ·
   `AI Gateway` · `Run`. It is sent as `cf-aig-authorization` and is consumed
   by the gateway; `CLOUDFLARE_API_TOKEN` still travels on to Workers AI. Leave
   it unset for an open gateway, which is the default a new gateway is created
   with.

With a gateway configured, every `[AUDIT]` line gains a real
`gatewayRequestId`, so any reading a reviewer saw can be traced back to the
exact inference in the gateway log. Without one it reads `"none"`, honestly.

### Caching is not just about cost

Two reviewers opening the same case ask the same question of the same
passages. With the gateway they get the **same answer**; without it they can
get two different readings of one document. Given that "two reviewers on one
case" is the conflict this app exists to resolve, this matters more than the
money.

### When every model call returns 401

This is worth its own heading because the error is misleading and the fix is
not where it points.

```
[AUDIT] … "embedding":"failed","embeddingDetail":"http: 401 Unauthorized from
https://gateway.ai.cloudflare.com/v1/…/workers-ai/@cf/baai/bge-base-en-v1.5"
```

That reads as a bad token, and it usually is not. The gateway refuses the
request **before Workers AI ever sees it** — internal code 2009 — so the same
account id and token that answer 200 here:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/baai/bge-base-en-v1.5" -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "content-type: application/json" -d '{"text":["headache"]}'
```

can still fail against the gateway URL. If the direct call above works and the
gateway one does not, the credentials are fine and the gateway is not.

The gateway returns **the identical 401 for three different causes**, so there
is no way to tell them apart from the response:

- no gateway of that name exists on that account (a name copied from this file
  without creating the gateway does this);
- the account id does not match the gateway;
- Authenticated Gateway is on and no `SIDENOTE_AI_GATEWAY_TOKEN` was sent, or
  the one sent lacks `AI Gateway · Run`.

Check them in that order. The app now says all three in its failure message
rather than printing the raw 401.

**The escape hatch** is to unset `SIDENOTE_AI_GATEWAY_ID`, which calls Workers
AI directly. It is deliberately not automatic: falling back on its own would
mean somebody believes they have a spend cap and a shared cache and has
neither, and "two reviewers on one case see the same reading" is the property
the gateway is here for. A gateway that is configured is used, or the call
fails loudly.

---

## Step 6 (optional, later) — Deploy to Workers for the native binding

Only worth doing when you deploy. It removes the token and the egress hop.

1. Install the Cloudflare adapter for Next
   (`@opennextjs/cloudflare` — **check its Next 16 support first**; this is the
   one step in this guide with real version risk).
2. Add `wrangler.jsonc` with an `ai` binding:
   ```jsonc
   { "ai": { "binding": "AI" } }
   ```
3. Deploy.

No code changes. `resolveAiBinding` prefers `env.AI` whenever it is present and
falls back to HTTP otherwise, so both routes work from the same build.

### Seed the fixture cases into D1 — required, once per database

```bash
npm run seed:cases:sql && npx wrangler d1 execute sidenote --remote --file=drizzle/seed-cases.sql
```

Skip this and the deployment looks fine until somebody presses **Assess this
case**, which returns a 500.

The twelve demo cases are built in code by `buildSeedCases()` and are not rows
in any database — which is invisible locally, because with no D1 binding the
assessment store falls through to the disk and there are no foreign keys there
to violate. On a deployment there are: `assessments.case_id` references
`cases(id)`, so storing an assessment against a case that is not in the table
fails the constraint and takes the case screen down with it. Ruling fails the
same way, for the same reason.

The rows are anchors for that key, not a second copy of the truth.
`loadQueue` filters them back out of the store listing and renders the code
fixture, so the queue shows each case once and the clocks stay honest as the
days pass — `src/lib/queue/entries.ts` says so next to the filter. Re-running
the seed is safe: it upserts, and deliberately does not use `REPLACE INTO`,
which would delete the case row first and cascade every assessment hanging off
it.

---

## Turning it off again

```
SIDENOTE_AI_DISABLED=1
```

Wins over any credentials. Every panel returns to the honest degraded state and
nothing breaks — that path is walked end to end in
`src/lib/assess/degraded.test.ts`.

---

## Trying it without a Cloudflare account at all

There is a stub that speaks the real Workers AI REST protocol, for development
and demos:

```bash
node scripts/stub-model.mjs 8787
```

Then:

```
CLOUDFLARE_ACCOUNT_ID=stub
CLOUDFLARE_API_TOKEN=stub
SIDENOTE_AI_BASE_URL=http://localhost:8787
```

It reads the passages it is sent and quotes them back verbatim, so the whole
chain — transport, parsing, the verbatim check, rendering — runs exactly as it
would against Cloudflare. It is not a language model and will not surprise you;
it exists to prove the plumbing, not the intelligence.

---


## Turning on semantic search

Retrieval is hybrid on the reviewer's **Assess this case** button: BM25 over
chunk text, fused with cosine similarity over embeddings, through Reciprocal
Rank Fusion.

**The default needs nothing new.** The same `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` that turn on generation also turn on embeddings, and the
vector store defaults to a local file-backed index under `.data/vectors`. That
was a deliberate choice: a feature that stays dark until somebody provisions a
remote service is a feature nobody reviews.

The local index is brute-force cosine over every vector. Microseconds at
fixture scale, painful past a few thousand chunks — the library screen and the
audit line both say which store you are on.

### Two things to do once

**1. Generate the seed vectors.** The fourteen seeded chunks ship without
embeddings, because an embedding is a network call and the fixtures are built
synchronously at module load.

```
npm run embed:seed
```

This needs **real credentials**. It refuses to run with `SIDENOTE_AI_BASE_URL`
set, because the stub server hashes words into buckets and an artifact of those
labelled `@cf/baai/bge-base-en-v1.5` would be a file claiming an inference that
never happened. Until you run it, semantic search covers uploaded documents
only and the seeded demo corpus stays keyword-only.

**2. Backfill anything already uploaded.** Documents uploaded before this
landed have no vectors and nothing would ever revisit them.

```
npm run embed:backfill
```

New uploads are embedded automatically. A document shows **"Chunked and
mirrored. Keyword search only"** until its vectors are in, and **"Chunked,
mirrored and embedded"** afterwards — that status is written only after the
upsert actually resolved, so it is not a promise.

### Switching between the stub and real credentials

Vectors written while `SIDENOTE_AI_BASE_URL` was set are stamped as such and
are **ignored** by a run using real credentials, and vice versa. This is on
purpose: stub vectors are hashed word buckets, and scoring a real query vector
against them would rank confidently over noise with nothing saying so. You do
not need to clear `.data/vectors` by hand, but re-run `npm run embed:backfill`
after switching so the documents are re-embedded by the model you are actually
using.

### Optional: Cloudflare Vectorize

Only worth doing past a few thousand chunks. Everything works without it.

1. **Widen the API token.** The one from the generation setup is scoped
   `Workers AI · Read`. Add `Account · Vectorize · Edit`, or every call 403s.

2. **Create the index** — 768 dimensions and cosine, both of which must match
   `@cf/baai/bge-base-en-v1.5` exactly. The client reads the index config and
   **refuses to query a non-cosine index**, because the relevance floor is a
   similarity where higher is better and a euclidean index returns a distance
   where lower is better — the same floor would then admit everything
   unrelated and reject everything good, silently.

   ```
   curl -X POST \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/vectorize/v2/indexes" \
     -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "content-type: application/json" \
     -d '{"name":"sidenote","config":{"dimensions":768,"metric":"cosine"}}'
   ```

3. **Create the metadata index** so `sourceType` can be filtered. Without it
   the filter is rejected and every query over-fetches.

   ```
   curl -X POST \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/vectorize/v2/indexes/sidenote/metadata_index/create" \
     -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "content-type: application/json" \
     -d '{"propertyName":"sourceType","indexType":"string"}'
   ```

4. **Point the app at it** in `.env.local`, then backfill:

   ```
   SIDENOTE_VECTORIZE_INDEX=sidenote
   ```
   ```
   npm run embed:backfill
   ```

No `wrangler` needed — all three calls are REST, consistent with the rest of
this file.

**Note on scope.** `documentId` is deliberately *not* sent in the Vectorize
metadata filter. The guarantee that a Covaxil case never cites a Hepalex
document is a post-filter in `dense.ts` that runs against the library mirror,
and it must not depend on a remote service's filter semantics. The remote
filter is an optimisation.

### The off switch

```
SIDENOTE_VECTOR_DISABLED=1
```

Wins over everything, mirroring `SIDENOTE_AI_DISABLED`. Retrieval falls back to
lexical-only and says so on the audit line. Setting `SIDENOTE_AI_DISABLED=1`
also turns off the dense half, because semantic search needs the same model
access generation does.

---

## What this still does *not* turn on

Being clear about the ceiling, because there is still a real one.

**FDA labels need no setup at all.** openFDA is open — no key, no account.
Name a medicine on `/report/search`, in the intake chat, or on a case, and its
real FDA label is fetched, chunked, embedded and cited. The library mirror is
the cache, so each label is fetched once. `OPENFDA_API_KEY` is not read by
anything; a key would only raise the rate limit, and the cache is what keeps
this inside the unauthenticated one.

**The intake chat is hybrid now, and the order it got there in is the point.**
It used to be lexical-only — literal overlap plus a 24-entry synonym table — and
measured against the seeded corpus it missed "my face puffed up" (*angioedema*),
"heart was racing" (*tachycardia*) and "my muscles ached all over" (*myalgia*).

Adding the dense half was the obvious next step and it was the wrong one first.
`assessAgainstDocuments` turned a bare retrieval hit into `alreadyDescribed`,
which tells a member of the public their reaction *"does appear in the published
information"* — with **no model reading the passage**. A better retriever on
that path would not have made the answer truer, only more confident.

So the shape was fixed first, in this order: give the verdict a third state, so
"searched and found nothing" stops reading the same as "nothing was in scope to
search"; stop asserting on a ranking alone by putting a model between the
ranking and the sentence; and only then add dense. The conversation now ends in
a review step that retrieves, has a model read the passages, shows the reporter
what will be filed, and writes nothing until they press send. It reaches that
through `answerPublicQuestion` — the same function the public search page calls
— so the verbatim check, the single retry, the honest degraded state and the
public-only namespace lock all apply here unchanged, and the hybrid ranking came
with them rather than being bolted on.

**Nothing is automatic.** Assessment runs when a reviewer presses the button,
not when a case arrives. An inference costs money and a button makes it obvious
one was spent. The queue consumer that does this on arrival is Cluster E.

**A semantically-near passage is a new failure mode.** Dense retrieval can
surface a plausible-but-wrong paragraph that lexical never would. The verbatim
check still guarantees any *quotation* is real and scoping still guarantees the
right product — but a near-miss from the right document is a new way to put a
misleading-yet-honest citation in front of a reviewer. Worth watching.

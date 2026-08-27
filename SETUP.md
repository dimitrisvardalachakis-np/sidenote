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

With a gateway configured, every `[AUDIT]` line gains a real
`gatewayRequestId`, so any reading a reviewer saw can be traced back to the
exact inference in the gateway log. Without one it reads `"none"`, honestly.

### Caching is not just about cost

Two reviewers opening the same case ask the same question of the same
passages. With the gateway they get the **same answer**; without it they can
get two different readings of one document. Given that "two reviewers on one
case" is the conflict this app exists to resolve, this matters more than the
money.

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

## What this does *not* turn on

Being clear about the ceiling, because it is a real one.

The retrieval half is **lexical only** — BM25 over chunk text. There are no
embeddings and no vector search, so matching a reporter's words to a label's
words relies on literal overlap plus a hand-written table of 25 synonym
entries (`rash` ↔ `erythema`, and so on).

Outside that table there is no bridge:

- "my face puffed up" → *angioedema* — **missed**
- "heart was racing" → *tachycardia* — **missed**

When retrieval misses, the model is never asked, and the screen says
"No matching passage" — which reads like a finding. Closing that gap means
embedding chunks with `@cf/baai/bge-base-en-v1.5` into Vectorize and passing
the dense results as a second ranking to `fuseByRank`, which already accepts
several and has only ever been given one. That is the next real piece of work,
and it is what makes the retrieval genuinely *hybrid* as the design intends.

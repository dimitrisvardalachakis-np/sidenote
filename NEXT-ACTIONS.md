# Next actions — after the merge, before the demo

Written 31 Aug 2026 against `main @ 83f1389`, and kept up to date since. Items
1, 2, 2b and 2c are done. The app has now run on workerd and the remote D1 is
migrated; what remains is item 3's console work and the deploy itself.

---

## 1. DONE — claiming a case now changes what the screens show

Fixed in `348941b`, and the diagnosis above was right in every particular.
`ClaimStore.put` and `ClaimStore.clear` turned out to have no callers left
anywhere, which is the sharpest statement of it: the write half of that store
was already dead and only its reads were still wired up.

Option **(a)** as recommended. `CaseCoordinator` writes a `claims` row inside
the same turn it grants or releases; the queue and the rail read it through a
new `held()` on `CaseCoordination`; the case screen reads the object, because
that value gates the ruling form and a write control should be drawn from the
thing that would refuse the write.

Two decisions the note left open:

- **`release()` writes a lapsed claim instead of deleting one.** The seeds
  apply only where the coordinator has never spoken, so deleting would return
  the object to never-spoken and hand case 105 back to A. Okonkwo. It is also
  why there is no `released_at` column — nothing here distinguishes released
  from lapsed, and `claimIsLive` stays the only liveness rule.
- **`claim-store.ts` is deleted, not kept as the stand-in's backing.** Its UUID
  guard nulls out `coordination.test.ts`'s `case-N` ids, so every
  contested-claim test would have passed against an empty store, and on real
  uuids `npm test` would write live 30-minute claims into `.data` that leak
  into the next run. The stand-in keeps its Map and gains the same seeded
  fallback, so `arbitrates: false` still behaves.

`arbitrates` is now genuinely rendered, under the claim control. It never had
been — the only read in the repository was an assertion in a unit test, while
three comments claimed the screen reported it.

`src/app/(app)/case/[id]/actions.test.ts` is the seam test. Written first
against the old read path, it failed exactly as predicted.

---

## 1b. DONE — six stores asked the storage type a question it could not answer

Fixed in `c3d394d`, found while tracing the read path. `StorageBacking` has
three members and six callers tested it as `!== "ephemeral"`, which asks "is
storage durable" rather than "is there a disk". On a deployed Worker with D1
bound those differ, so `assessment-store`, `last-visit`, `audit-store` and
`document-store` all took the disk branch and threw out of `nodeFs()`.

That is a 500 on every reviewer route, and `assessment-store` is reached by
`loadQueue` for every entry — so it would have fired before any of the claim
work above was observable. `hasLocalDisk()` now sits beside
`isStorageDurable()` and each site asks the one it meant.

---

## 2. DONE — the AI Worker and its service binding

Landed as the third commit. `worker-ai/` is a second Worker with
`workers_dev: false`, its own `AI` and Vectorize bindings and a constant-time
shared-secret check that runs before the body is parsed. The app declares a
`services` binding named `ASSESS` and reaches it through
`assessThroughService()`, which falls back to running the identical code
in-process when the binding is absent — which is every run under `next dev` and
in the suite.

One zod module, `src/lib/assess/wire.ts`, is imported by both sides and parsed
by both. Scope does not cross: which documents belong to a case is decided
app-side before anything is sent. Every span that comes back is re-checked
against the chunks that were sent, and a finding that fails is discarded whole.

**Not proven end to end.** A `services` binding needs two deployed Workers.
What is tested is this side of the boundary against a stand-in Fetcher, and the
Worker's front door by calling its handler directly.

---

## 2b. DONE — the suite flaked about one run in six

Fixed in `344b327`, and my first diagnosis was wrong: not cross-file `.data/`
interference but **real network calls**. `runLabelDiff` read the developer's
own `.data/cases`, collected 5 distinct substances and made 5 serial HTTPS
requests to api.fda.gov — 8.35s measured, against vitest's 5s default timeout.
`pretendToBeWorkers()` takes it to the in-memory store, the case list is empty
and the loop never runs: 5 fetch calls before, 0 after. 0 failures in 15 runs.

---

## 2c. DONE — first run on workerd, and what it found

Six defects fixed in `e6e6366`, three more in `c2587cd`. None was visible to
typecheck, lint, the suite or `next build`.

**Stopped it starting:** `"entrypoint": "default"` on the services binding (it
names a `WorkerEntrypoint` subclass, not the default export).

**Stopped every reviewer route:** `SIDENOTE_SESSION_SECRET` is required in
production and was documented nowhere — `next dev` falls back to the published
default, `wrangler dev` serves a production build, so the guard fired and every
authenticated route 500'd. **A deploy following the docs would have done the
same.** Now in `.dev.vars.example`.

**Stopped the build:** `.wrangler/**` was missing from eslint's ignores, so
running the app once produced 19,643 lint problems and `npm run build` failed.

**The generation model had been retired since 2026-05-30.**
`@cf/meta/llama-3.1-8b-instruct` answers `5028: ... was deprecated`. Three
months, unnoticed, because every layer degraded exactly as designed. Now
`-fp8`. The reason it went unnoticed was its own finding: the audit line
recorded `status: "unavailable"` and not *why*. Adding `reason` turned a shrug
into the diagnosis in one request.

**The clock could never arm, and the queue could never start** — see `c2587cd`.
Assessments had two homes; the sweeps read the one the reviewer never wrote to.

Proven on workerd, not merely in the suite: two reviewers racing one case, 6/6
exactly one winner; the claim visible in the queue through the D1 mirror;
`arbitrates` true; idempotent replay; both crons twice with the second changing
nothing; the rate-limit *binding* (`Retry-After: 60` matches the binding
policy, not the in-memory one); Workers AI on the native binding
(`source: "workers-binding"`); Vectorize hybrid retrieval; a verified verbatim
quotation from a real FDA label; the services binding connected with the AI
Worker doing both namespace readings; and the ingest queue running producer →
consumer → model → D1.

**Remote D1 is migrated.** `0003_case_claims.sql` applied to
`7f90d3f8-ec18-4251-ad20-5be3d659be23`; `claims` exists with its six columns
and nothing is pending.

### Still not proven

- **DLQ.** The queue itself now runs end to end, but reaching
  `sidenote-ingest-dlq` needs a message whose `runStep` *throws* — a malformed
  one is `ack()`ed to `queue_message_rejected` by design and never gets there.
- **Turnstile on the browser path.** No keys. The machine path correctly logs
  `bot_check_not_applicable/machine_caller`; the browser path could not be
  driven over HTTP because `submitReportAction` takes an object, not FormData.
- **R2.** Bound and simulated locally, and it does not block startup — but the
  upload path needs a browser, since pdf.js extracts client-side.
- **The narrative generation times out at 10s** against the fp8 model, while
  the reading succeeds. The UI shows one unavailable and the other standing,
  which is correct; the timeout may want raising.

### One thing to carry into the deploy

`wrangler dev` needs a token that can reach Workers AI **and** Vectorize. The
`CLOUDFLARE_API_TOKEN` in `.env.local` is AI-only: it 403s on Vectorize and
cannot authenticate the AI binding's mandatory remote proxy session, which is
not optional (`remote: false` throws). `CF_PROVISION_TOKEN` does both and is
what the local runs used. A deployment wants one scoped to both, not the
provisioning token.

---

## 3. Deploy — blocked on a wider API token, then mechanical

`CLOUDFLARE_API_TOKEN` in `.env.local` is Workers-AI-only (verifies fine;
returns `Authentication error` for `/workers/scripts`, `/d1/database`,
`/ai-gateway/gateways`). Once `CF_PROVISION_TOKEN` is in `.env.local`, the
resources can be created over REST.

Resources to create (names from `scripts/cloudflare-setup.sh`):

| Kind | Name |
|---|---|
| D1 | `sidenote` |
| R2 | `sidenote-documents` |
| KV | `CACHE` |
| Queue | `sidenote-ingest` |
| DLQ | `sidenote-ingest-dlq` |
| Vectorize | `sidenote-chunks`, 768 dims, cosine |

Then `wrangler.jsonc:74` `database_id` and `:95` KV `id` replace the
placeholders, then `npm run cf-typegen && npm run db:migrate:remote && npm run
deploy`.

**`wrangler` must run on the Mac.** It cannot run in the Cowork bridge VM — the
installed `miniflare`/`workerd` binaries are macOS-native and the bridge shell is
Linux (same reason `vitest` will not start there).

### Console work still outstanding

- **Turnstile widget** — create it, add every hostname *including*
  `sidenote.<subdomain>.workers.dev`, put the keys in `.dev.vars` /
  `wrangler secret put`. The audit log currently shows
  `bot_check_skipped / no_turnstile_configured` on every submission.
- **R2 S3 credentials** (`R2_S3_*` in `.dev.vars.example`) — presigning is SigV4
  against R2's S3 API and needs the four values, not the binding. All four or
  none; a partial set fails at PUT time in the browser with someone else's CORS
  message.
- **AI Gateway spend cap** — the gateway itself is live and caching (the same
  `gatewayRequestId` repeats across requests minutes apart in
  `.data/audit/_legacy/public_search.jsonl`). The cap is a dashboard setting and
  is not set.

---

## 4. Run it under `wrangler dev` before deploying

There is no `.wrangler` directory: the Durable Objects, the queue consumer and
`scheduled()` have never executed on `workerd`, only against unit-test fakes.
Bug 1 above is exactly the class of defect that survives unit tests and dies on
first contact with the real runtime — assume there are one or two more.

Do this before the deploy, not after.

---

## 5. Small and already done

- README and SETUP.md both still described the intake chat as lexical-only; the
  chat's review step calls `answerPublicQuestion`, which is hybrid. Corrected in
  `83f1389` (committed, **not pushed**).
- 16 stale flat `.data/audit/*.jsonl` files, left over from before the
  target-namespacing fix, moved to `.data/audit/_legacy/`. New writes go to
  `cases/` and `subjects/`.

## 6. Optional, cheap

- Delete the merged branches on GitHub: `fix-report-form-questions`,
  `ux-redesign`, `claude/cluster-c-implementation-plan-2hu77o`,
  `claude/generation-retrieval-assessment-kjkwov`.
- Set the repo description and, once deployed, the homepage URL — it is the
  first thing anyone opening the Slack link sees.
- A `.github/workflows/deploy.yml`. Not required by the course.

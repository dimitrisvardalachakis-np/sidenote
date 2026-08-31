# Next actions — after the merge, before the demo

Written 31 Aug 2026 against `main @ 83f1389`. Two of these are mine to hand over;
the first is urgent.

---

## 1. BUG: claiming a case does not change what any screen shows

**Severity: demo-killer.** This is the contested write — the one interaction the
README spends a page justifying and the demo opens on.

### What is wrong

The write path and the read path point at two different stores, and nothing
bridges them.

**Writes** — `src/app/(app)/case/[id]/actions.ts`
```
:246   coordination.claim(...)
:302   coordination.release(...)
:411   coordination.rule(...)
```
go to `getCaseCoordination()` → `UnarbitratedCoordination`'s private in-memory
`Map` under `next dev`, or `CaseCoordinator` (the Durable Object) deployed.

**Reads** — every render site
```
src/app/(app)/case/[id]/page.tsx:138   (await getClaimStore()).get(record.id)
src/app/(app)/queue/page.tsx:49,85     (await getClaimStore()).all()
src/app/(app)/layout.tsx:45            (await getClaimStore()).all()
```
go to `getClaimStore()` → `.data/claims/*.json` plus the two hardcoded `SEEDED`
holders.

`grep getClaimStore src/lib/coordinator/` → nothing. `grep getCaseCoordination
src/lib/store/claim-store.ts` → only prose. `case-store.ts:276` uses the
coordinator, but only for `mintReference`. **There is no sync.**

`revalidatePath()` at `:262`, `:314`, `:462` re-renders the page, which re-reads
the store the write never touched.

### Symptom

Press "Claim this case" → the action returns `granted`, an `[AUDIT] claim_case`
line is written, and the screen still says nobody holds it. Press again →
`already_yours`. The queue never shows a live claim at all; it shows the two
seeded holders and nothing else, forever.

### Why the tests miss it

`coordination.test.ts` exercises the coordinator in isolation and passes. There
is no test that claims through the action and then re-reads a page, so the seam
between the two is untested. **Add that test as part of the fix** — it is the
only kind that would have caught this.

### How it got here

`ef51bce` ("Collapse the two retrieval stacks, the two AI stacks and the two
claim modules") correctly moved the *writes* onto the coordinator and left the
*reads* on the store. Pre-merge both went through `getClaimStore()`, so it
worked.

### The fix — and the real design question

The per-case screen is easy: read `(await getCaseCoordination()).state(id).claim`
instead of `getClaimStore().get(id)`.

**The queue listing is the actual problem.** It needs "who holds each of the 16
cases", and a Durable Object addressed `idFromName(caseId)` cannot answer a
question about all cases. Three options:

- **(a) Mirror claims into D1.** `CaseCoordinator` writes a `claims` row on every
  successful claim/release. The queue reads that table; the case screen still
  reads the DO, which stays the single source of truth. There is currently **no
  `claims` table** — the D1 schema has `assessments, audit_log, cases, chunks,
  documents, drugs, reactions` — so this needs a fourth migration.
  *Recommended.* It matches how the rest of the app already mirrors DO state,
  it makes the queue one query instead of sixteen, and a stale mirror is
  harmless because the DO refuses the write anyway.
- **(b) Fan out from the queue** — call `state()` on every case's DO per render.
  16 round trips per page load, and it grows with the queue. Correct but wrong
  shape.
- **(c) Keep `claim-store` as the mirror** and have the coordinator dual-write.
  Cheapest change, but it leaves a filesystem store on the Workers path, which
  is the thing the whole migration removed.

Take (a). Add the `claims` table, have the DO write it inside the same method
that grants the claim, point the queue at D1 and the case screen at the DO, and
keep `claim-store` only as the `next dev` stand-in's backing so `arbitrates =
false` still behaves.

**Note the seeded holders.** `claim-store.ts:83` `SEEDED` exists so a second
reviewer can see the "held by someone else" screen without a second identity.
That has to survive the fix — seed those two rows into D1 (or into the DO on
first touch) or the most important screen in the demo becomes unreachable.

---

## 2. Still unwritten: the separate AI Worker and its service binding

The only Cluster E line with nothing behind it. There is no `services` array in
`wrangler.jsonc` and no second worker — `src/lib/assess/` runs in-process.

Needs: a second Worker exposing the RAG path, `workers_dev: false`, a
shared-secret header check, a `services` binding from the app, and the app
calling it through that binding rather than in-process. The fallback the rubric
asks for already exists and needs no change — `resolveAiBinding` returns null
with a reason and every caller degrades honestly.

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

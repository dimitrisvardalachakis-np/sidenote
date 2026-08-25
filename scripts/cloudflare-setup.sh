#!/usr/bin/env bash
#
# Creates every Cloudflare resource this app binds, then fills the two ids that
# have to be pasted into wrangler.jsonc.
#
# WHY A SCRIPT AND NOT A LIST IN A README.
#
# There are six resources across three clusters, two of them mint an id you
# then have to copy into a config file, and one of them (Vectorize) takes a
# dimension count that is not a preference — get it wrong and every upsert
# fails later, at a moment that says nothing about the mistake. A list of
# commands in prose is a list somebody runs four of.
#
# IDEMPOTENT. Every create is allowed to fail with "already exists"; the ids are
# read back with `list` afterwards rather than scraped from the create output,
# so re-running this on a half-finished account finishes it rather than
# starting again.
#
#   ./scripts/cloudflare-setup.sh          create, then print what to paste
#   ./scripts/cloudflare-setup.sh --write  create, then paste it for you
#
# Run `wrangler login` first. This script deliberately does not: authenticating
# is the one step that should be a conscious act.

set -euo pipefail

WRITE=false
[ "${1:-}" = "--write" ] && WRITE=true

cd "$(dirname "$0")/.."

D1_NAME="sidenote"
R2_NAME="sidenote-documents"
KV_BINDING="CACHE"
QUEUE_NAME="sidenote-ingest"
DLQ_NAME="sidenote-ingest-dlq"
VECTORIZE_NAME="sidenote-chunks"

# Must match @cf/baai/bge-base-en-v1.5. An index created at another width
# rejects every upsert, and the error arrives at ingestion time.
EMBEDDING_DIMENSIONS=768

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# Create, tolerating "already exists" — but only that. Any other failure is a
# real one and should stop the run rather than be swallowed by `|| true`.
create() {
  local what="$1"; shift
  local output
  if output=$(npx wrangler "$@" 2>&1); then
    note "created  $what"
  elif grep -qiE "already exists|already have|duplicate" <<<"$output"; then
    note "exists   $what"
  else
    printf '\n%s\n' "$output" >&2
    printf '\nFailed creating %s. Nothing after this point ran.\n' "$what" >&2
    exit 1
  fi
}

say "Checking you are logged in"
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "  Not authenticated. Run: npx wrangler login" >&2
  exit 1
fi
npx wrangler whoami 2>/dev/null | grep -iE "account|email" | head -2 || true

say "Cluster D — storage"
create "D1 database $D1_NAME"        d1 create "$D1_NAME"
create "R2 bucket $R2_NAME"          r2 bucket create "$R2_NAME"
create "KV namespace $KV_BINDING"    kv namespace create "$KV_BINDING"

say "Cluster E — pipeline"
create "queue $QUEUE_NAME"           queues create "$QUEUE_NAME"
create "dead-letter queue $DLQ_NAME" queues create "$DLQ_NAME"
create "Vectorize index $VECTORIZE_NAME (${EMBEDDING_DIMENSIONS}d, cosine)" \
  vectorize create "$VECTORIZE_NAME" \
  --dimensions="$EMBEDDING_DIMENSIONS" --metric=cosine

# ---------------------------------------------------------------------------
# The two ids that have to reach wrangler.jsonc
# ---------------------------------------------------------------------------

say "Reading back the ids"

D1_ID=$(npx wrangler d1 list --json 2>/dev/null \
  | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        const db=(JSON.parse(s)||[]).find(d=>d.name===process.argv[1]);
        process.stdout.write(db?db.uuid:'');
      });" "$D1_NAME")

KV_ID=$(npx wrangler kv namespace list 2>/dev/null \
  | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        // The binding name is prefixed with the worker name by wrangler.
        const ns=(JSON.parse(s)||[]).find(n=>n.title.endsWith(process.argv[1]));
        process.stdout.write(ns?ns.id:'');
      });" "$KV_BINDING")

[ -n "$D1_ID" ] || { echo "  Could not read the D1 id back." >&2; exit 1; }
[ -n "$KV_ID" ] || { echo "  Could not read the KV id back." >&2; exit 1; }

note "D1 database_id  $D1_ID"
note "KV id           $KV_ID"

D1_PLACEHOLDER="00000000-0000-0000-0000-000000000000"
KV_PLACEHOLDER="00000000000000000000000000000000"

if [ "$WRITE" = true ]; then
  say "Writing them into wrangler.jsonc"
  # Exact-string replacement of the two known placeholders. Deliberately not a
  # JSON round-trip: wrangler.jsonc is full of comments that explain why each
  # binding is shaped the way it is, and reserialising would delete all of them.
  node - "$D1_ID" "$KV_ID" "$D1_PLACEHOLDER" "$KV_PLACEHOLDER" <<'NODE'
const fs = require("node:fs");
const [d1, kv, d1Placeholder, kvPlaceholder] = process.argv.slice(2);
const path = "wrangler.jsonc";
let text = fs.readFileSync(path, "utf8");

let changed = 0;
if (text.includes(d1Placeholder)) { text = text.replace(d1Placeholder, d1); changed++; }
if (text.includes(kvPlaceholder)) { text = text.replace(kvPlaceholder, kv); changed++; }

fs.writeFileSync(path, text);
console.log(`  ${changed} id(s) written, ${2 - changed} already set`);
NODE
  note "Now run: npm run cf-typegen && npm run db:migrate:remote"
else
  say "Paste these into wrangler.jsonc"
  cat <<EOF

  "d1_databases": [{ ... "database_id": "$D1_ID" ... }]
  "kv_namespaces": [{ ... "id": "$KV_ID" ... }]

  Or re-run with --write to have them written for you.
EOF
fi

say "Still manual, on purpose"
cat <<'EOF'
  Secrets are never written by a script:

    npx wrangler secret put TURNSTILE_SECRET_KEY
    npx wrangler secret put R2_S3_SECRET_ACCESS_KEY

  And the R2 S3 credentials are a dashboard visit, not a CLI command:
  R2 > Manage API tokens > Create. They are what presigned uploads need;
  without them uploads still work, through the Server Action, size-capped.

  Then: npm run db:migrate:remote
EOF

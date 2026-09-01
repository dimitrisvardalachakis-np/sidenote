/**
 * Refuses to deploy against placeholder resource ids.
 *
 * A SECOND THING THIS FILE CANNOT CHECK, RECORDED HERE BECAUSE IT COST TWO
 * DEPLOYS. `opennextjs-cloudflare deploy` does not build — it uploads whatever
 * is already in `.open-next`. So `npm run deploy` used to ship the last bundle
 * anybody happened to have built, reported complete success, and printed a new
 * Version ID for code that was not in it. Two deploys landed that way and the
 * evidence was a single easily-missed line: "No updated asset files to
 * upload." Everything then verified against the OLD app, including a
 * measurement that sent the narrative work down a wrong path for an hour.
 *
 * `npm run deploy` now runs `build:worker` first, which is lint, the suite and
 * the OpenNext build. That is the guard; this comment is why it is there.
 *
 * wrangler.jsonc ships with `database_id: "0000…"` and a KV id of the same
 * shape, so that the whole app can be built and tested locally without a
 * Cloudflare account — local D1 and KV ignore the id entirely and use a file
 * under .wrangler.
 *
 * That is a good default and a bad thing to deploy. The failure it produces is
 * not "you forgot to run the setup script": it is a 7404 from the API about a
 * database that does not exist, or worse, a Worker that deploys and then
 * throws on the first request that touches storage. Neither names the cause.
 *
 * So this runs before `deploy` and says the actual sentence.
 *
 * Deliberately NOT run before `preview`. Previewing against local emulation
 * with placeholder ids is exactly the intended workflow, and a preflight that
 * blocked it would be a preflight people learn to bypass.
 */
import { readFileSync } from "node:fs";

const PLACEHOLDERS = [
  {
    value: "00000000-0000-0000-0000-000000000000",
    field: "d1_databases[].database_id",
    fix: "npx wrangler d1 create sidenote",
  },
  {
    value: "00000000000000000000000000000000",
    field: "kv_namespaces[].id",
    fix: "npx wrangler kv namespace create CACHE",
  },
];

/**
 * Strip // and /* comments from JSONC, ignoring anything inside a string.
 *
 * Written out rather than regexed, and duplicated from the copy in
 * rate-limit.test.ts on purpose: this file runs under plain node before any
 * build step, so it cannot import from src/, and a shared module would have to
 * exist in a form both a .mjs script and a TypeScript test can load. Thirty
 * lines of pure function is the cheaper duplication.
 */
function stripJsonComments(source) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const raw = readFileSync("wrangler.jsonc", "utf8");

// Parsed rather than string-searched, so a placeholder mentioned in one of the
// explanatory comments does not trip this. Those comments name the value.
const config = JSON.parse(stripJsonComments(raw));
const serialised = JSON.stringify(config);

const unset = PLACEHOLDERS.filter((p) => serialised.includes(p.value));

if (unset.length === 0) {
  process.exit(0);
}

const lines = [
  "",
  "  Refusing to deploy: wrangler.jsonc still has placeholder resource ids.",
  "",
  "  These are the local-development defaults. Local D1 and KV ignore the id",
  "  and use a file under .wrangler, which is why everything works offline —",
  "  but deployed they point at nothing, and the failure you would get says",
  "  so in a way that names the API and not the cause.",
  "",
  ...unset.flatMap((p) => [`    ${p.field}`, `      ${p.fix}`, ""]),
  "  Or create everything at once, and have the ids written for you:",
  "",
  "    ./scripts/cloudflare-setup.sh --write",
  "",
  "  Then: npm run cf-typegen && npm run db:migrate:remote",
  "",
];

process.stderr.write(`${lines.join("\n")}\n`);
process.exit(1);

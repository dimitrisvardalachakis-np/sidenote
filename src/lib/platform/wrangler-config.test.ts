import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Claims wrangler.jsonc makes about the code, checked against the code.
 *
 * WRITTEN AFTER A CONFIG BUG STOPPED THE RUNTIME STARTING AT ALL.
 *
 * The `services` binding was declared with `"entrypoint": "default"`, on the
 * reasonable-sounding assumption that it names the default export. It does
 * not — it names a `WorkerEntrypoint` subclass exported by the target Worker,
 * and workerd refused to boot:
 *
 *   binding "ASSESS" refers to service "sidenote-assess" with a named
 *   entrypoint "default", but it has no such named entrypoint
 *
 * Nothing caught it. `tsc` does not read wrangler.jsonc, eslint does not read
 * wrangler.jsonc, the test suite did not read wrangler.jsonc, and `next build`
 * has no opinion about it. It was invisible until the first `wrangler dev`,
 * which is the one place it was fatal rather than cosmetic.
 *
 * So this file exists to make the config's cross-references checkable at the
 * same moment as the code they refer to.
 */

const ROOT = process.cwd();

/**
 * JSONC, without a dependency.
 *
 * Comments are the whole reason wrangler.jsonc is a .jsonc, and this repo uses
 * them heavily — stripping them is the price of asserting on the file people
 * actually edit rather than a duplicate somebody has to remember to update.
 * String-aware, because `"https://..."` contains what looks like a comment.
 */
function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += next ?? ""; i += 1; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i += 1; continue; }
    if (c === "/" && next === "*") { inBlock = true; i += 1; continue; }
    out += c;
  }

  // Trailing commas are legal in jsonc and not in JSON.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as unknown;
}

function config(path: string): Record<string, unknown> {
  return parseJsonc(readFileSync(join(ROOT, path), "utf8")) as Record<
    string,
    unknown
  >;
}

const app = config("wrangler.jsonc");
const assess = config("worker-ai/wrangler.jsonc");

describe("the service binding to the AI Worker", () => {
  const services = (app["services"] ?? []) as readonly Record<string, unknown>[];

  it("points at the Worker that worker-ai/wrangler.jsonc names", () => {
    const target = services.find((s) => s["binding"] === "ASSESS");
    expect(target?.["service"]).toBe(assess["name"]);
  });

  it("names no entrypoint, because the AI Worker exports only a default", () => {
    const source = readFileSync(
      join(ROOT, "worker-ai", String(assess["main"] ?? "index.ts")),
      "utf8",
    );

    for (const service of services) {
      const entrypoint = service["entrypoint"];
      if (entrypoint === undefined) continue;

      // Not a string the config may invent: it must be a class the target
      // Worker actually exports, or workerd refuses to start.
      expect(String(entrypoint)).not.toBe("default");
      expect(source).toMatch(
        new RegExp(`export\\s+class\\s+${String(entrypoint)}\\b`),
      );
    }
  });

  it("keeps the AI Worker off the public internet", () => {
    // The shared secret in index.ts is the other half. This is the half a
    // dashboard could undo, which is why it is asserted rather than trusted.
    expect(assess["workers_dev"]).toBe(false);
  });
});

describe("the Durable Objects", () => {
  it("bind only classes the entry module exports", () => {
    const entry = readFileSync(join(ROOT, String(app["main"])), "utf8");
    const objects = app["durable_objects"] as
      | { bindings?: readonly Record<string, unknown>[] }
      | undefined;

    for (const binding of objects?.bindings ?? []) {
      const name = String(binding["class_name"]);
      // A Durable Object class that is not exported FROM THE ENTRY MODULE does
      // not exist as far as the runtime is concerned, however correctly it is
      // bound — worker/index.ts says so at length, and this checks it.
      expect(entry).toMatch(new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`));
    }
  });

  it("declares every bound class in a migration", () => {
    const migrations = (app["migrations"] ?? []) as readonly Record<
      string,
      unknown
    >[];
    const declared = new Set(
      migrations.flatMap((m) => [
        ...((m["new_sqlite_classes"] ?? []) as string[]),
        ...((m["new_classes"] ?? []) as string[]),
      ]),
    );
    const objects = app["durable_objects"] as
      | { bindings?: readonly Record<string, unknown>[] }
      | undefined;

    for (const binding of objects?.bindings ?? []) {
      expect(declared).toContain(String(binding["class_name"]));
    }
  });
});

describe("D1", () => {
  it("looks for migrations where drizzle-kit writes them", () => {
    // drizzle.config.ts's `out` and this must agree, or `drizzle-kit generate`
    // writes migrations `wrangler d1 migrations apply` cannot see.
    const d1 = (app["d1_databases"] ?? []) as readonly Record<string, unknown>[];
    const drizzleConfig = readFileSync(join(ROOT, "drizzle.config.ts"), "utf8");
    const out = /out:\s*"\.\/([^"]+)"/.exec(drizzleConfig)?.[1];

    expect(out).toBeDefined();
    for (const db of d1) expect(db["migrations_dir"]).toBe(out);
  });
});

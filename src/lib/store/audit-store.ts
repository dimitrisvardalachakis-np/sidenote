import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setAuditSink, type AuditRecord } from "@/lib/audit";

/**
 * The audit trail, kept so a screen can show it.
 *
 * Non-negotiable #9 has emitted `[AUDIT]` lines since the first cluster and no
 * screen has ever displayed one, which is an odd thing for a tool whose whole
 * pitch is that every decision is logged. This keeps them.
 *
 * JSONL, appended, one file per target — a case reference is a target, so the
 * case screen reads exactly the lines about that case with no scan and no
 * index. Append-only is the point: an audit trail you can rewrite is not one.
 *
 * Importing this module installs it. That is a side effect, which is usually
 * worth avoiding, and it is the right trade here: the alternative is
 * remembering to call a register function from every entry point, and the one
 * that gets forgotten is the one whose mutations go unrecorded.
 */

const DIR = join(process.cwd(), ".data", "audit");

/** A target becomes a filename, so it must not be able to escape the directory. */
function fileFor(target: string): string | null {
  const safe = target.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safe.length === 0 || safe === "." || safe === "..") return null;
  return join(DIR, `${safe}.jsonl`);
}

/**
 * Queued rather than awaited.
 *
 * `audit()` is synchronous and called from inside mutations; making it async
 * would change twenty call sites and make a log write something a reviewer
 * waits for. Writes are chained onto one promise so appends to the same file
 * cannot interleave, and a failure is swallowed — the console line is the
 * record that must not be lost, and it has already been written.
 */
let pending: Promise<void> = Promise.resolve();

function append(record: AuditRecord): void {
  const path = fileFor(record.target);
  if (path === null) return;
  pending = pending
    .then(async () => {
      await mkdir(DIR, { recursive: true });
      await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    })
    .catch(() => {
      // A journal that cannot be written must not break the thing it records.
    });
}

setAuditSink(append);

/** Wait for queued writes to land. For a caller that is about to read them. */
export async function flushAuditTrail(): Promise<void> {
  await pending;
}

/**
 * The trail for one target, newest first.
 *
 * A malformed line is skipped rather than failing the read: a half-written
 * final line is the normal shape of a crash, and losing the whole history to
 * it would be the wrong trade.
 */
export async function readAuditTrail(
  target: string,
  limit = 50,
): Promise<readonly AuditRecord[]> {
  const path = fileFor(target);
  if (path === null) return [];
  await flushAuditTrail();

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }

  const records: AuditRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line) as AuditRecord);
    } catch {
      continue;
    }
  }
  return records.reverse().slice(0, limit);
}

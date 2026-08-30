import "server-only";
import { setAuditSink, type AuditRecord } from "@/lib/audit";
import { dataPath, nodeFs, nodePath, storageBacking } from "./backing";

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

/** A case reference: the only target shape with a format worth trusting. */
const CASE_REFERENCE = /^SN-\d{4}-\d{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which shelf a target's journal belongs on.
 *
 * A TARGET IS NOT A NAMESPACE, AND FLATTENING THEM COLLIDED.
 *
 * Every journal used to be `<target>.jsonl` in one directory, and `target` is
 * whatever the emitting call site had to hand — a case reference, a document
 * id, a drug name, a route, a client IP. `.data/audit` accordingly grew
 * `SN-2026-000101.jsonl` next to `amoxil.jsonl`, `public_search.jsonl` and
 * `__ffff_127.0.0.1.jsonl`. Two of those are not case histories and one is
 * personal data filed under a name that looks like a case.
 *
 * The collision is the real defect rather than the untidiness: a drug called
 * `SN-2026-000101` is absurd, but a DOCUMENT id and a case reference sharing a
 * filename is not, and the case screen reads its history by target. Separate
 * shelves make that unambiguous, and make "delete the client-IP journals"
 * something you can actually do.
 */
function shelfFor(target: string): string {
  if (CASE_REFERENCE.test(target)) return "cases";
  if (UUID.test(target)) return "documents";
  // Anything with a colon or more than one dot is an address, not a name.
  if (target.includes(":") || (target.match(/\./g)?.length ?? 0) > 1) {
    return "clients";
  }
  return "subjects";
}

/** A target becomes a filename, so it must not be able to escape the directory. */
function safeName(target: string): string | null {
  const safe = target.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safe.length === 0 || safe === "." || safe === "..") return null;
  return `${safe}.jsonl`;
}

async function fileFor(target: string): Promise<string | null> {
  const name = safeName(target);
  if (name === null) return null;
  const { join } = await nodePath();
  return join(await dataPath("audit", shelfFor(target)), name);
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
  pending = pending
    .then(async () => {
      // No disk: the console line has already been written, which is the
      // record non-negotiable #9 actually requires. The journal is what lets a
      // SCREEN show it, and a screen that shows nothing is honest.
      if ((await storageBacking()) === "ephemeral") return;
      const path = await fileFor(record.target);
      if (path === null) return;
      const { appendFile, mkdir } = await nodeFs();
      const { dirname } = await nodePath();
      await mkdir(dirname(path), { recursive: true });
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
  await flushAuditTrail();
  if ((await storageBacking()) === "ephemeral") return [];

  const path = await fileFor(target);
  if (path === null) return [];

  const { readFile } = await nodeFs();
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

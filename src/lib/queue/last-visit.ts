import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * When each reviewer last looked at the queue.
 *
 * The screen looked identical whether three cases arrived overnight or none,
 * which is an odd thing for a page people come back to every morning. This is
 * the smallest thing that fixes it.
 *
 * Per reviewer, because "new to me" is the only useful reading of new — a
 * colleague having seen a case does not mean this reviewer has. Stored beside
 * the other stores and rebuilt from nothing if lost: a missing timestamp marks
 * nothing rather than marking everything, and a queue where all sixteen cases
 * are new says exactly as much as one where none is.
 */
const DIR = join(process.cwd(), ".data", "visits");

function fileFor(reviewerId: string): string | null {
  const safe = reviewerId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safe.length === 0 || safe === "." || safe === "..") return null;
  return join(DIR, `${safe}.txt`);
}

export async function readLastVisit(reviewerId: string): Promise<string | null> {
  const path = fileFor(reviewerId);
  if (path === null) return null;
  try {
    const raw = (await readFile(path, "utf8")).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function recordVisit(reviewerId: string): Promise<void> {
  const path = fileFor(reviewerId);
  if (path === null) return;
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(path, new Date().toISOString(), "utf8");
  } catch {
    // Not being able to remember the visit is not worth failing a page render.
  }
}

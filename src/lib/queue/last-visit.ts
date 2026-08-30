import "server-only";
import {
  dataPath,
  ephemeralSingleton,
  nodeFs,
  nodePath,
  storageBacking,
} from "@/lib/store/backing";

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
/** A reviewer id becomes a filename, so it must not be able to escape the directory. */
function safeName(reviewerId: string): string | null {
  const safe = reviewerId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safe.length === 0 || safe === "." || safe === "..") return null;
  return `${safe}.txt`;
}

/**
 * No disk: remember the visit for as long as the isolate lives.
 *
 * Losing it marks nothing rather than marking everything, which is the same
 * degradation a first-ever visit produces — so unlike the other stores this one
 * needs no ephemeral audit line. There is no false promise to announce.
 */
const visits = () =>
  ephemeralSingleton("last_visit", () => new Map<string, string>());

export async function readLastVisit(reviewerId: string): Promise<string | null> {
  const name = safeName(reviewerId);
  if (name === null) return null;

  if ((await storageBacking()) === "ephemeral") {
    return visits().get(name) ?? null;
  }

  const { readFile } = await nodeFs();
  const { join } = await nodePath();
  try {
    const raw = (
      await readFile(join(await dataPath("visits"), name), "utf8")
    ).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function recordVisit(reviewerId: string): Promise<void> {
  const name = safeName(reviewerId);
  if (name === null) return;
  const now = new Date().toISOString();

  if ((await storageBacking()) === "ephemeral") {
    visits().set(name, now);
    return;
  }

  try {
    const { mkdir, writeFile } = await nodeFs();
    const { join } = await nodePath();
    const dir = await dataPath("visits");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), now, "utf8");
  } catch {
    // Not being able to remember the visit is not worth failing a page render.
  }
}

import "server-only";
import { z } from "zod";
import { recordAudit } from "@/lib/audit-log";
import { CACHE_KEY, getCache } from "@/lib/cache/kv";
import { fetchJson } from "@/lib/fetch";
import { dispatch } from "@/lib/pipeline";
import { getAssessmentStore } from "@/lib/store/assessment-store";
import { getCaseStore } from "@/lib/store/case-store";
import { CaseId } from "@/lib/schemas";

/**
 * The nightly label diff, and the re-flag it triggers.
 *
 * CLAUDE.md's whole premise: "Expectedness — is the reaction described in the
 * *public* FDA label?" and "The two can disagree. The company document is
 * usually updated first." A label is not a constant. When the FDA publishes a
 * new version of one, every case assessed against the old version was assessed
 * against a document that no longer says what it said.
 *
 * That is not a stale cache. It is a case whose expectedness finding may have
 * flipped — and expectedness flipping is what turns an already-reported
 * reaction into a newly-unexpected one, which is the thing the 15-day clock
 * exists for. So a changed label re-enqueues assessment for the cases that
 * cited it rather than waiting for a reviewer to notice.
 *
 * THIS IS ALSO KV'S THIRD JOB. CLAUDE.md gives KV "cached label lookups", and
 * this is the only thing in the app that fetches a label. The cache is what
 * makes "did it change?" answerable at all: something has to remember what it
 * said last night, and it is rebuildable by definition — the answer is one
 * fetch away.
 */

const OPENFDA_ENDPOINT = "https://api.fda.gov/drug/label.json";

/**
 * The two fields that identify a label version, and nothing else.
 *
 * openFDA returns a large document. Parsing all of it would couple this to a
 * schema nobody here controls and break the diff every time the FDA adds a
 * field. `set_id` names the label and `effective_time` names the version;
 * a change in either is a change worth re-assessing.
 */
const LabelResponse = z.object({
  results: z
    .array(
      z.object({
        openfda: z
          .object({ spl_set_id: z.array(z.string()).optional() })
          .optional(),
        effective_time: z.string().optional(),
        id: z.string().optional(),
      }),
    )
    .min(1),
});

const CachedLabel = z.object({
  setId: z.string(),
  effectiveTime: z.string(),
  checkedAt: z.string(),
});
type CachedLabel = z.output<typeof CachedLabel>;

export interface LabelDiffReport {
  readonly substances: number;
  readonly checked: number;
  readonly changed: number;
  readonly reflagged: number;
  readonly unavailable: number;
}

export async function runLabelDiff(): Promise<LabelDiffReport> {
  const store = await getCaseStore();
  const cases = await store.list();

  const open = cases.filter(
    (record) => record.status !== "reported" && record.status !== "closed",
  );

  // One check per SUBSTANCE, not per case. Twenty cases about the same drug
  // are one label, and asking openFDA twenty times for it is both slower and a
  // good way to get rate limited by a public API.
  const bySubstance = new Map<string, string[]>();
  for (const record of open) {
    for (const drug of record.drugs) {
      if (drug.role !== "suspect") continue;
      const substance = (drug.activeSubstance ?? drug.reportedName)
        .trim()
        .toLowerCase();
      if (substance === "") continue;
      const bucket = bySubstance.get(substance);
      if (bucket === undefined) bySubstance.set(substance, [record.id]);
      else bucket.push(record.id);
    }
  }

  let checked = 0;
  let changed = 0;
  let reflagged = 0;
  let unavailable = 0;

  for (const [substance, caseIds] of bySubstance) {
    const current = await fetchLabel(substance);
    if (current === null) {
      unavailable += 1;
      continue;
    }
    checked += 1;

    const cache = await getCache();
    const key = CACHE_KEY.label(substance);

    // Read-through: the first run for a substance simply records what the label
    // says today. There is nothing to diff against on the first night, and
    // treating "no previous value" as a change would re-assess every case in
    // the system the first time this ran.
    const previous = await cache.cached(
      key,
      CachedLabel,
      LABEL_TTL_SECONDS,
      async () => current,
    );

    if (
      previous.setId === current.setId &&
      previous.effectiveTime === current.effectiveTime
    ) {
      continue;
    }

    changed += 1;
    await cache.drop(key);

    // Re-assess only cases that HAVE an assessment. One that was never assessed
    // is already queued or already visibly unassessed; adding it here would
    // hide a pipeline failure behind a nightly retry.
    // Through the store, for the reason deadline-sweep.ts gives at length.
    // It matters more here: this gate is the ONLY producer the ingest queue
    // has, and the only writer of the rows it was reading was the queue's own
    // consumer — so nothing could ever prime it and the queue could not start.
    const assessments = await (await getAssessmentStore()).getMany(caseIds);
    // Counted per substance. `reflagged` is the run total and reporting it on
    // a per-substance line would say "12 cases" for a drug that had two.
    let reflaggedHere = 0;
    for (const caseId of caseIds) {
      if (!assessments.has(caseId)) continue;
      await dispatch({ kind: "assess_case", caseId: CaseId.parse(caseId) });
      reflaggedHere += 1;
    }
    reflagged += reflaggedHere;

    await recordAudit({
      actor: "system",
      action: "label_changed",
      target: substance,
      outcome: "success",
      detail: {
        from: `${previous.setId}@${previous.effectiveTime}`,
        to: `${current.setId}@${current.effectiveTime}`,
        cases: reflaggedHere,
      },
    });
  }

  await recordAudit({
    actor: "system",
    action: "label_diff_sweep",
    target: "openfda",
    outcome: "success",
    detail: {
      substances: bySubstance.size,
      checked,
      changed,
      reflagged,
      unavailable,
    },
  });

  return {
    substances: bySubstance.size,
    checked,
    changed,
    reflagged,
    unavailable,
  };
}

/**
 * A WEEK, not a day — and the difference is the whole feature.
 *
 * The obvious value is 24 hours, matching the sweep. That is exactly wrong: the
 * cache IS the memory of what the label said last night, and a TTL equal to the
 * interval means it may expire minutes before the run that needs it. Then
 * `cached()` misses, re-fetches, stores today's value, compares it with itself,
 * and finds no change — every night, forever. The diff would never fire once,
 * and nothing would look broken.
 *
 * Seven days leaves six spare so a late or skipped run still has something to
 * compare against.
 */
const LABEL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Ask openFDA what the label says now.
 *
 * Returns null on ANY failure, including "no such drug". Both are genuinely
 * the same answer for this sweep — there is nothing to compare — and neither
 * is an error worth failing the whole run over. openFDA answers 404 for a
 * search with no matches, which is why a 404 is not logged as a fault.
 *
 * Note that the seeded drugs in this demo are invented (Covaxil, Hepalex,
 * Cardiquel), so this returns null for all of them. That is correct: they are
 * not real products and have no real labels. Borrowing a real product's safety
 * profile for a demo would be the worse choice.
 */
async function fetchLabel(substance: string): Promise<CachedLabel | null> {
  // The substance is interpolated into a QUERY EXPRESSION, not a plain
  // parameter — openFDA's `search` has its own syntax with quotes, `AND`/`OR`
  // and `+`. A drug name carrying a quote would break the query, and the
  // failure would be a 404 that this function reads as "no such label", which
  // is a different and quieter wrong answer. Reduced to characters that cannot
  // mean anything to the parser.
  const safe = substance.replace(/[^a-z0-9 -]/gi, " ").trim();
  if (safe === "") return null;

  const url = new URL(OPENFDA_ENDPOINT);
  url.searchParams.set(
    "search",
    `openfda.generic_name:"${safe}" OR openfda.brand_name:"${safe}"`,
  );
  url.searchParams.set("limit", "1");

  try {
    const response = await fetchJson(url, LabelResponse, {
      signal: AbortSignal.timeout(10_000),
    });

    const first = response.results[0];
    if (first === undefined) return null;

    const setId = first.openfda?.spl_set_id?.[0] ?? first.id;
    const effectiveTime = first.effective_time;
    if (setId === undefined || effectiveTime === undefined) return null;

    return { setId, effectiveTime, checkedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

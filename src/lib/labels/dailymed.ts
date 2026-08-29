/**
 * The link out to the genuine FDA record.
 *
 * `openfda.ts` uses the label's `spl_set_id` directly as the document id —
 * "so a citation traces to a public FDA record anyone can check". This is the
 * function that finishes that sentence. DailyMed, run by the National Library
 * of Medicine, keys its public label pages on exactly that set id, so the URL
 * is derivable with no data-model change and no stored field.
 *
 * PUBLIC LABELS ONLY. A company document id is a uuid we minted; handing it to
 * DailyMed would produce a dead link that looks like a citation and, worse,
 * would imply a confidential CCDS has a public counterpart to check it
 * against. The caller passes the source type and this refuses anything else.
 */
import type { SourceType } from "@/lib/schemas";

const DAILYMED_LABEL = "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm";

/**
 * openFDA set ids are lowercase uuids. Anything else is not one, and building
 * a URL out of it would produce a link that 404s while looking authoritative.
 */
const SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function dailyMedUrl(
  splSetId: string | null,
  sourceType: SourceType,
): string | null {
  if (sourceType !== "public") return null;
  if (splSetId === null) return null;
  const id = splSetId.trim().toLowerCase();
  if (!SET_ID.test(id)) return null;
  return `${DAILYMED_LABEL}?setid=${id}`;
}

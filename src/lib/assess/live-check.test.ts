/**
 * What the six demo cases ACTUALLY say when a real model reads them.
 *
 * Gated behind SIDENOTE_LIVE_CHECK=1 and run with `npm run check:live`, so it
 * is a no-op inside `npm run build` — it spends real inferences and takes a
 * minute. It is in the same family as `embed:seed` and `embed:backfill`: a
 * script that has to reach the model, living as a gated test because there is
 * no tsx in this project and a plain .mjs cannot resolve the `@/` alias.
 *
 * IT EXISTS BECAUSE A BADGE AND ITS EVIDENCE CAN DISAGREE. `sourcesDisagree`
 * is computed from the reviewer's RULING, and a ruling survives a re-run by
 * design — so a case can carry a confident "Sources disagree" headline above
 * two panels that, when actually assessed, both say "describes it". Nothing
 * errors. The screen simply asserts two things at once, and the only way to
 * find out before an audience does is to run the assessment and read the
 * stances back.
 *
 * It prints rather than asserts, deliberately. What the right answer is for a
 * given case is a judgement about a safety document, and encoding one here
 * would be this file ruling on listedness. It reports what came back; a human
 * decides whether that is the case they meant to demonstrate.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessCase } from "./assess";
import { resolveAiBinding, resolveGateway } from "./ai";
import { resolveDenseFor } from "@/lib/retrieval/resolve";
import { documentsForDrug } from "./scope";
import { SEED_CHUNKS, SEED_DOCUMENTS } from "@/lib/fixtures/documents";
import { documentStance } from "@/lib/schemas";

const CASES = [
  {
    ref: "SN-2026-000101",
    drug: { reportedName: "Hepalex", activeSubstance: "hepalexin" },
    term: "liver failure, died",
  },
  {
    ref: "SN-2026-000102",
    drug: { reportedName: "Hepalex", activeSubstance: "hepalexin" },
    term: "yellow skin and eyes",
  },
  {
    ref: "SN-2026-000105",
    drug: { reportedName: "Pulmoxa", activeSubstance: "pulmoxetine" },
    term: "interstitial lung disease",
  },
  {
    ref: "SN-2026-500015",
    drug: { reportedName: "Hepalex", activeSubstance: "hepalexin" },
    term: "About ten days after starting the tablets her eyes and skin turned yellow and she was very tired and itchy. Her urine went dark. The GP sent her for blood tests and said her liver readings were high.",
  },
  {
    ref: "SN-2026-500016",
    drug: { reportedName: "Pulmoxa", activeSubstance: "pulmoxetine" },
    term: "He became very short of breath over about three weeks and had a dry cough that would not settle. A scan at the hospital showed scarring on both lungs and the consultant called it interstitial lung disease. He was kept in overnight for oxygen.",
  },
  {
    ref: "SN-2026-500017",
    drug: { reportedName: "Hepalex", activeSubstance: "hepalexin" },
    term: "Since starting the tablets she has felt very sick to her stomach most mornings and has had headaches almost every day. She is also tired all the time. She has not been to hospital and is still taking the medicine.",
  },
];

describe.runIf(process.env["SIDENOTE_LIVE_CHECK"] === "1")(
  "every demo case, assessed for real",
  () => {
    it("assesses each demo case against the real model", async () => {
      const env = process.env as unknown as Record<string, unknown>;
      const ai = resolveAiBinding(env);
      const dense = resolveDenseFor(env, ai);
      const out: string[] = [
        `ai.source=${ai.source} reason=${ai.reason ?? "-"}`,
      ];

      for (const c of CASES) {
        const r = await assessCase({
          chunks: SEED_CHUNKS,
          documentIds: documentsForDrug(SEED_DOCUMENTS, c.drug),
          reactionTerm: c.term,
          drugName: c.drug.reportedName,
          documentKind: "ccds",
          labelSetId: null,
          ai,
          dense,
          gateway: resolveGateway(env),
          now: new Date().toISOString(),
          actor: "live-check",
          target: c.ref,
        });
        const side = (f: typeof r.listedness | typeof r.expectedness) => {
          const stance = documentStance(f);
          const reading = f.state === "grounded" ? f.reading.status : "-";
          const narr =
            f.state === "grounded" ? (f.narrative?.status ?? "none") : "-";
          return `${f.state}/${reading}/narr:${narr} => ${stance}`;
        };
        out.push(
          `\n### ${c.ref} — ${c.drug.reportedName} — "${c.term.slice(0, 60)}…"`,
        );
        out.push(`  company: ${side(r.listedness)}`);
        out.push(`  public : ${side(r.expectedness)}`);
        if (
          r.listedness.state === "grounded" &&
          r.listedness.reading.status === "read"
        ) {
          out.push(`    span: "${r.listedness.reading.quotedSpan}"`);
          out.push(`    why : ${r.listedness.reading.rationale ?? "(none)"}`);
        }
        if (
          r.expectedness.state === "grounded" &&
          r.expectedness.reading.status === "read"
        ) {
          out.push(`    span: "${r.expectedness.reading.quotedSpan}"`);
          out.push(`    why : ${r.expectedness.reading.rationale ?? "(none)"}`);
        }
      }
      writeFileSync("/tmp/livecheck.txt", out.join("\n"));
      expect(out.length).toBeGreaterThan(0);
    }, 300_000);
  },
);

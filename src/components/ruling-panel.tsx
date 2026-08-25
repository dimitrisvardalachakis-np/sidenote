"use client";

import { useState, useTransition } from "react";
import {
  claimCaseAction,
  releaseCaseAction,
  ruleCaseAction,
} from "@/app/(app)/case/[id]/actions";
import type { CaseClaim } from "@/lib/schemas/claim";
import type { ReviewerRuling } from "@/lib/schemas";

/**
 * The one screen where a human decides something.
 *
 * Everything above this panel is the model's work, labelled as suggestions.
 * Non-negotiable #4 says the model never decides — so this is the only control
 * in the application that turns a suggestion into the case's answer, and it is
 * deliberately shaped to make that obvious: you cannot record a ruling without
 * holding the case, and you cannot hold it if somebody else does.
 *
 * The determination fields DEFAULT TO NOTHING SELECTED, even when the model has
 * a suggestion. Pre-filling them with the model's answer would make accepting
 * it the path of least resistance, and a reviewer clicking through a
 * pre-filled form is not a reviewer deciding — it is the model deciding with a
 * human's name attached.
 */

type Listedness = "listed" | "unlisted" | "indeterminate";
type Expectedness = "expected" | "unexpected" | "indeterminate";

const LISTEDNESS_LABELS: ReadonlyArray<{ value: Listedness; label: string }> = [
  { value: "listed", label: "Listed — the company document describes it" },
  { value: "unlisted", label: "Unlisted — it does not" },
  { value: "indeterminate", label: "Cannot tell from the document" },
];

const EXPECTEDNESS_LABELS: ReadonlyArray<{
  value: Expectedness;
  label: string;
}> = [
  { value: "expected", label: "Expected — the FDA label describes it" },
  { value: "unexpected", label: "Unexpected — it does not" },
  { value: "indeterminate", label: "Cannot tell from the label" },
];

export function RulingPanel({
  caseId,
  reviewerId,
  claim,
  ruling,
  arbitrates,
}: {
  readonly caseId: string;
  readonly reviewerId: string;
  readonly claim: CaseClaim | null;
  readonly ruling: ReviewerRuling | null;
  /** False when no Durable Object is bound. Said out loud, not hidden. */
  readonly arbitrates: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [listedness, setListedness] = useState<Listedness | "">("");
  const [expectedness, setExpectedness] = useState<Expectedness | "">("");
  const [rationale, setRationale] = useState("");

  const heldByMe = claim !== null && claim.reviewerId === reviewerId;
  const heldByOther = claim !== null && claim.reviewerId !== reviewerId;
  const canRule =
    heldByMe && listedness !== "" && expectedness !== "" && rationale.trim() !== "";

  function claimCase() {
    startTransition(async () => {
      const { outcome } = await claimCaseAction(caseId);
      setMessage(
        outcome.status === "refused"
          ? `${outcome.heldBy.displayName} is holding this case.`
          : null,
      );
    });
  }

  function releaseCase() {
    startTransition(async () => {
      await releaseCaseAction(caseId);
      setMessage(null);
    });
  }

  function submitRuling() {
    startTransition(async () => {
      const result = await ruleCaseAction(caseId, {
        listedness,
        expectedness,
        rationale,
      });
      setMessage(result.message);
      if (result.ok) {
        setRationale("");
        setListedness("");
        setExpectedness("");
      }
    });
  }

  return (
    <div>
      {!arbitrates && (
        <p className="mb-3 border-l-2 border-ink bg-row-hover px-3 py-2 text-meta">
          No case coordinator is bound here, so claiming is not arbitrated
          between people — it works between tabs on this machine and nowhere
          else. Two reviewers could hold this case at once.
        </p>
      )}

      {ruling !== null ? (
        <div className="border-l-2 border-steady pl-3">
          <p className="text-base">
            <span className="text-steady">{ruling.listedness}</span> /{" "}
            <span className="text-steady">{ruling.expectedness}</span>
          </p>
          <p className="mt-1 text-prose">{ruling.rationale}</p>
          <p className="mt-1 text-micro uppercase tracking-label text-slate">
            {ruling.decidedBy} · {ruling.decidedAt.slice(0, 16).replace("T", " ")}
          </p>
        </div>
      ) : (
        <p className="text-base">
          No ruling yet. Nothing above counts as a decision until a reviewer
          records one here.
        </p>
      )}

      {/* ------------------------------------------------------------ claim */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {heldByOther ? (
          <p className="text-base">
            <span className="font-medium">{claim.displayName}</span> is
            reviewing this case, until{" "}
            {claim.expiresAt.slice(11, 16)} UTC.
          </p>
        ) : heldByMe ? (
          <>
            <p className="text-base">
              You are holding this case until {claim.expiresAt.slice(11, 16)}{" "}
              UTC.
            </p>
            <button
              type="button"
              onClick={releaseCase}
              disabled={pending}
              className="cursor-pointer rounded-soft border border-rule px-3 py-1.5 text-base hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Release
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={claimCase}
            disabled={pending}
            className="cursor-pointer rounded-soft border border-ink bg-ink px-3 py-1.5 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-not-allowed disabled:opacity-40"
          >
            Claim this case
          </button>
        )}
      </div>

      {message !== null && (
        <p
          role="alert"
          className="mt-3 border-l-2 border-ink bg-row-hover px-3 py-2 text-base"
        >
          {message}
        </p>
      )}

      {/* ------------------------------------------------------------- rule */}
      {heldByMe && (
        <div className="mt-5 border-t border-rule pt-4">
          <fieldset>
            <legend className="text-micro uppercase tracking-label text-slate">
              Listedness — the company document
            </legend>
            <div className="mt-1.5">
              {LISTEDNESS_LABELS.map((option) => (
                <label key={option.value} className="mt-1 flex items-start gap-2">
                  <input
                    type="radio"
                    name="listedness"
                    value={option.value}
                    checked={listedness === option.value}
                    onChange={() => setListedness(option.value)}
                    className="mt-1"
                  />
                  <span className="text-base">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-micro uppercase tracking-label text-slate">
              Expectedness — the FDA label
            </legend>
            <div className="mt-1.5">
              {EXPECTEDNESS_LABELS.map((option) => (
                <label key={option.value} className="mt-1 flex items-start gap-2">
                  <input
                    type="radio"
                    name="expectedness"
                    value={option.value}
                    checked={expectedness === option.value}
                    onChange={() => setExpectedness(option.value)}
                    className="mt-1"
                  />
                  <span className="text-base">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <label
              htmlFor="rationale"
              className="text-micro uppercase tracking-label text-slate"
            >
              Why
            </label>
            <textarea
              id="rationale"
              rows={3}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              aria-describedby="rationale-hint"
              className="mt-1 w-full rounded-soft border border-rule bg-paper px-2 py-1.5 text-prose focus:outline-2 focus:outline-offset-1 focus:outline-steady"
            />
            <p id="rationale-hint" className="mt-1 text-meta text-slate">
              Required. The next person to open this case reads this before
              anything else.
            </p>
          </div>

          <button
            type="button"
            onClick={submitRuling}
            disabled={pending || !canRule}
            className="mt-4 cursor-pointer rounded-soft border border-ink bg-ink px-4 py-2 text-base text-paper hover:border-steady hover:bg-steady disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Recording" : "Record my ruling"}
          </button>
        </div>
      )}
    </div>
  );
}

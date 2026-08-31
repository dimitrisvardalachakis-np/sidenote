// @vitest-environment jsdom
/**
 * What the claim panel actually says, in each of its states.
 *
 * Written for the fourth thing it says. `arbitrates` had existed on the
 * coordination interface since Cluster D, three comments asserted that the UI
 * reported it, and no page, layout or component read it — the only read in the
 * repository was an assertion in a unit test. So `next dev`, where a Map
 * decides who holds a case, rendered a panel identical to the deployed one,
 * where a Durable Object does. That is the exact difference the stand-in is
 * named `UnarbitratedCoordination` to keep visible.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimPanel } from "./claim-panel";
import type { CaseClaim } from "@/lib/case/claim";
import type { IsoDateTime } from "@/lib/schemas";
import { INITIAL_CLAIM_STATE, type ClaimActionState } from "@/app/(app)/case/[id]/ruling-state";

const noop = vi.fn(
  async (_state: ClaimActionState, _form: FormData) => INITIAL_CLAIM_STATE,
);

const HELD_BY_THEM: CaseClaim = {
  reviewerId: "reviewer-ao",
  displayName: "A. Okonkwo",
  heldSince: "2026-08-29T09:12:00.000Z" as IsoDateTime,
  expiresAt: "2099-01-01T00:00:00.000Z" as IsoDateTime,
};

function panel(over: {
  claim?: CaseClaim | null;
  reviewerId?: string;
  arbitrated: boolean;
}) {
  return render(
    <ClaimPanel
      claim={over.claim ?? null}
      reviewerId={over.reviewerId ?? "reviewer-demo"}
      arbitrated={over.arbitrated}
      claimAction={noop}
      releaseAction={noop}
    />,
  );
}

describe("what the panel says about who is arbitrating", () => {
  it("says nothing extra when a Durable Object is", () => {
    panel({ arbitrated: true });

    expect(screen.getByRole("button", { name: /claim this case/i })).toBeVisible();
    expect(screen.queryByText(/do not hold across machines/i)).toBeNull();
  });

  it("says so plainly when it is only this process", () => {
    panel({ arbitrated: false });

    // The reviewer is about to rely on a guarantee, so the caveat sits on the
    // control that offers it rather than in a banner somewhere else.
    expect(screen.getByText(/do not hold across machines/i)).toBeVisible();
  });

  it("repeats it to the reviewer who already holds the case", () => {
    panel({
      claim: { ...HELD_BY_THEM, reviewerId: "reviewer-demo" },
      arbitrated: false,
    });

    expect(screen.getByText(/held in this process only/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /release/i })).toBeVisible();
  });
});

describe("the three states it was written for", () => {
  it("names the colleague and offers no control when they hold it", () => {
    panel({ claim: HELD_BY_THEM, arbitrated: true });

    // Named twice on purpose — once as the holder, once in the sentence
    // saying what you may still do — so this asserts both, not "at least one".
    expect(screen.getAllByText(/A\. Okonkwo/)).toHaveLength(2);
    expect(screen.getByText(/since/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /claim this case/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /release/i })).toBeNull();
  });

  it("offers release when it is yours", () => {
    panel({
      claim: { ...HELD_BY_THEM, reviewerId: "reviewer-demo" },
      arbitrated: true,
    });

    expect(screen.getByRole("button", { name: /release/i })).toBeVisible();
  });

  it("offers the claim when nobody has it", () => {
    panel({ arbitrated: true });

    expect(screen.getByRole("button", { name: /claim this case/i })).toBeVisible();
  });
});

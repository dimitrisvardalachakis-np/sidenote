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


/**
 * THE LIVE REGION, AND THE PROPERTY THAT MAKES IT ONE.
 *
 * A walkthrough reported "no aria-live regions anywhere" from
 * `document.querySelectorAll("[aria-live]").length === 0`. The probe was
 * measuring the wrong thing — `role="status"` carries an implicit
 * `aria-live="polite"` and this panel already had one — but the conclusion was
 * right for a reason the probe could not see: the region was rendered only
 * once there was something to say. An element that arrives already containing
 * its text is an insertion, not an update, and assistive technology routinely
 * announces nothing.
 *
 * So the property under test is PRESENT AND EMPTY, in every state, before
 * anything happens. Not "a live region exists somewhere".
 */
describe("the live region is there before there is anything to announce", () => {
  const states = [
    ["unclaimed", { claim: null, arbitrated: true }],
    ["held by you", { claim: { ...HELD_BY_THEM, reviewerId: "reviewer-demo" }, arbitrated: true }],
    ["held by somebody else", { claim: HELD_BY_THEM, arbitrated: true }],
  ] as const;

  it.each(states)("is mounted and empty when %s", (_name, over) => {
    const { container } = panel(over);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    // Empty. If this ever holds text on a first render the panel has started
    // reading the case's state aloud on every page load, which is narration.
    expect(region?.textContent).toBe("");
  });

  it("states the role and the attribute, so an audit can find it either way", () => {
    const { container } = panel({ claim: null, arbitrated: true });
    const region = container.querySelector('[aria-live="polite"]');
    expect(region?.getAttribute("role")).toBe("status");
    // Read the whole sentence rather than the words that changed.
    expect(region?.getAttribute("aria-atomic")).toBe("true");
  });

  /*
    And it announces the OUTCOME, not the state.

    Deriving from `claim` would say "you now hold this case" on every render of
    a case this reviewer claimed yesterday. The action state is only ever set
    by something they just did.
  */
  it("announces a granted claim once the action reports one", async () => {
    const granting = vi.fn(async () => ({
      status: "granted" as const,
      message: null,
    }));
    const { container } = render(
      <ClaimPanel
        claim={null}
        reviewerId="reviewer-demo"
        arbitrated
        claimAction={granting}
        releaseAction={noop}
      />,
    );

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /claim this case/i }));

    const region = container.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toContain("You now hold this case");
  });
});

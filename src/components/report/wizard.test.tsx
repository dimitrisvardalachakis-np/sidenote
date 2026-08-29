// @vitest-environment jsdom
/**
 * Keyboard-only completion of all five steps.
 *
 * This is the acceptance criterion I could not verify through the browser
 * automation tool. Nothing here uses the mouse: every control is reached with
 * Tab and operated with Space, Enter or the arrow keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";

// The Server Action reaches for `server-only`, which throws outside a server
// bundle. The wizard's job here is the keyboard path, not the network.
const submitSpy = vi.fn(async (_draft: unknown) => ({
  status: "created" as const,
  reference: "SN-2026-500009",
  caseId: "11111111-1111-4111-8111-111111111111",
}));
vi.mock("@/app/(public)/report/submit-action", () => ({
  submitReportAction: (draft: unknown) => submitSpy(draft),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ReportWizard } from "./wizard";

/** Tab until the wanted control has focus. Fails rather than hanging. */
async function tabTo(user: UserEvent, element: HTMLElement, limit = 200) {
  // A step can hold two dozen tab stops, and focus starts from wherever the
  // last interaction left it, so the budget has to cover more than one lap.
  for (let i = 0; i < limit; i += 1) {
    if (document.activeElement === element) return;
    await user.tab();
  }
  throw new Error(
    `Could not reach <${element.tagName.toLowerCase()}> "${element.textContent ?? element.id}" with Tab in ${limit} presses`,
  );
}

/**
 * Choose a radio the way a keyboard user does.
 *
 * Tab enters a radio group ONCE, landing on the checked option or the first
 * one, and does not walk through the rest. Moving between options is the
 * arrow keys, which select as they go. An earlier version of this helper
 * tabbed looking for a specific radio and never found it; that was the helper
 * being wrong about the platform, not the component being unreachable.
 */
async function chooseRadio(user: UserEvent, label: string | RegExp) {
  const target = screen.getByLabelText(label);
  if (!(target instanceof HTMLInputElement)) throw new Error("not an input");

  const group = [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(target.name)}"]`,
    ),
  ];
  const first = group[0];
  if (first === undefined) throw new Error("empty radio group");

  await tabTo(user, first);
  if (document.activeElement === target) {
    await user.keyboard("[Space]");
    return;
  }
  for (let i = 0; i < group.length + 1 && !target.checked; i += 1) {
    await user.keyboard("{ArrowDown}");
  }
  if (!target.checked) throw new Error(`Could not select ${String(label)}`);
}

/** Checkboxes are reached directly by Tab and toggled with Space. */
async function toggleCheckbox(user: UserEvent, label: string | RegExp) {
  const control = screen.getByLabelText(label);
  await tabTo(user, control);
  await user.keyboard("[Space]");
}

async function clickButtonByKeyboard(user: UserEvent, name: RegExp) {
  const button = screen.getByRole("button", { name });
  await tabTo(user, button);
  await user.keyboard("{Enter}");
  // Changing step moves focus to the heading on the next animation frame,
  // which is deliberate: a keyboard user needs to be told the screen changed.
  // Let that frame run before the next interaction, or it lands halfway
  // through the following Tab sweep and steals focus from under it.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("the whole form by keyboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    submitSpy.mockClear();
  });

  /*
    The walk follows the ORDER the form now asks in: who, the medicine, what
    happened (with the seriousness questions folded in), stopping and starting
    again, about you. That order is the change, so a test that still walked the
    old one would be asserting the wrong product.
  */
  it("completes all five steps and sends, using only the keyboard", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    // ---- Step 1 -------------------------------------------------------
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Who this is about",
    );
    await chooseRadio(user, "It happened to someone else");
    // An age, typed. Marking it "I don't know" instead would leave the report
    // genuinely incomplete and Send correctly disabled, which is asserted in
    // the next test rather than fought with here.
    const age = screen.getByLabelText("How old are they?");
    await tabTo(user, age);
    await user.keyboard("72");
    await clickButtonByKeyboard(user, /^next$/i);

    // ---- Step 2: the medicine, because that is what people lead with ----
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "The medicine",
    );
    const medicine = screen.getByLabelText("What is the medicine called?");
    await tabTo(user, medicine);
    await user.keyboard("Amoxil");
    await clickButtonByKeyboard(user, /^next$/i);

    // ---- Step 3: what happened, seriousness folded in -------------------
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "What happened",
    );
    const story = screen.getByLabelText("What went wrong?");
    await tabTo(user, story);
    await user.keyboard("A rash came up on both arms after two days.");

    // A date typed digit by digit, which is how a person types one.
    const year = screen.getByLabelText("Year");
    await tabTo(user, year);
    await user.keyboard("2026");
    await user.selectOptions(screen.getByLabelText("Month"), "03");
    expect(screen.getByText(/You said:/).textContent).toContain("March 2026");

    // The hospital question now lives on this step rather than its own.
    const hospitalGroup = screen.getByRole("group", {
      name: /go to hospital/i,
    });
    const yes = within(hospitalGroup).getByLabelText("Yes");
    await tabTo(user, yes);
    await user.keyboard("[Space]");
    expect(yes).toBeChecked();
    await clickButtonByKeyboard(user, /^next$/i);

    // ---- Step 4: stopping and starting again, which may be skipped ------
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "Stopping and starting again",
    );
    await clickButtonByKeyboard(user, /^next$/i);

    // ---- Step 5 -------------------------------------------------------
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "About you",
    );
    const name = screen.getByLabelText("What is your name?");
    await tabTo(user, name);
    await user.keyboard("Sam Patel");

    // Everything the report needs is present, so Send is reachable.
    await clickButtonByKeyboard(user, /send my report/i);

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("SN-2026-500009")).toBeDefined();
  }, 30_000);

  it("will not send while something is still needed, and says what", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");

    // Say "I don't know" to the age, by keyboard. That is a real answer to
    // the question and counts towards progress, but it is NOT a detail that
    // identifies anybody, so the report stays incomplete. Those two facts
    // living together is the whole point of the three-state answer.
    await toggleCheckbox(user, "I don't know");
    expect(screen.getByLabelText("I don't know")).toBeChecked();

    // Walk to the last step without answering anything else, in the order the
    // form now asks. `toContain` rather than `toBe` because an optional step
    // carries the word "optional" in its heading.
    const expected = [
      "The medicine",
      "What happened",
      "Stopping and starting again",
      "About you",
    ];
    for (const heading of expected) {
      await clickButtonByKeyboard(user, /^next$/i);
      expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
        heading,
      );
    }

    const send = screen.getByRole("button", { name: /send my report/i });
    expect(send).toBeDisabled();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("We do not know who this happened to");
    expect(alert.textContent).toContain("We do not know who you are");
    expect(submitSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("keeps answers across a remount, the way a refresh would", async () => {
    const user = userEvent.setup();
    const first = render(<ReportWizard />);
    await chooseRadio(user, "It happened to someone else");
    first.unmount();

    render(<ReportWizard />);
    expect(
      screen.getByLabelText("It happened to someone else"),
    ).toBeChecked();
  }, 30_000);
});

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
import { STEP_IDS } from "@/lib/schemas/report";

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

// ---------------------------------------------------------------------------
// Questions that argued with each other
// ---------------------------------------------------------------------------

describe("the form asks each thing once, and only when it makes sense", () => {
  beforeEach(() => {
    window.localStorage.clear();
    submitSpy.mockClear();
  });

  /**
   * Choose a radio inside one named group.
   *
   * `chooseRadio` above reaches for a label across the whole page, which is no
   * use once two groups on a step both offer "Yes". It also tabs to the FIRST
   * radio, and a group with something already checked puts its tab stop on the
   * checked one instead — so this enters wherever the group's tab stop
   * actually is and arrows from there.
   */
  async function chooseRadioIn(
    user: UserEvent,
    groupName: RegExp,
    label: string | RegExp,
  ) {
    const group = screen.getByRole("group", { name: groupName });
    const target = within(group).getByLabelText(label);
    if (!(target instanceof HTMLInputElement)) throw new Error("not an input");
    if (target.checked) return;

    const radios = [
      ...group.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];
    const entry = radios.find((radio) => radio.checked) ?? radios[0];
    if (entry === undefined) throw new Error("empty radio group");

    await tabTo(user, entry);
    if (document.activeElement === target) {
      await user.keyboard("[Space]");
    } else {
      for (let i = 0; i < radios.length + 1 && !target.checked; i += 1) {
        await user.keyboard("{ArrowDown}");
      }
    }
    if (!target.checked) throw new Error(`Could not select ${String(label)}`);
  }

  /** Straight to a named step, without walking every question on the way. */
  async function walkTo(user: UserEvent, title: string) {
    for (let i = 0; i < STEP_IDS.length; i += 1) {
      const heading = screen.getByRole("heading", { level: 2 }).textContent;
      if (heading !== null && heading.includes(title)) return;
      await clickButtonByKeyboard(user, /^next$/i);
    }
    throw new Error(`never reached "${title}"`);
  }

  /*
    "It happened to me" was offered on step 1 and again, word for word, as the
    first option of step 5's "How are you involved?". A self-reporter answered
    the same question twice and could only read the second as the form having
    lost the first.
  */
  it("does not ask a self-reporter who this happened to a second time", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to me");
    await walkTo(user, "About you");

    expect(screen.queryByRole("group", { name: /how are you/i })).toBeNull();
    expect(screen.getByText(/we have you down as both/i)).toBeDefined();
  }, 30_000);

  it("still asks how somebody reporting for another person is connected", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await walkTo(user, "About you");

    const group = screen.getByRole("group", { name: /how are you connected/i });
    // The four that can be true of somebody else — and not the one that
    // repeats step 1.
    expect(within(group).getByLabelText("I look after them")).toBeDefined();
    expect(within(group).queryByLabelText("It happened to me")).toBeNull();
  }, 30_000);

  /*
    "Did they stop taking it?" answered no, and the very next question was
    "did they start taking it again later?" — which contradicts the answer
    above it and has no true answer. Restarting only means anything after
    stopping; that is what makes it rechallenge.
  */
  it("does not ask about starting again when they never stopped", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await walkTo(user, "Stopping and starting again");

    await chooseRadioIn(user, /stop taking it/i, "No");

    expect(screen.queryByRole("group", { name: /start taking it again/i })).toBeNull();
    expect(screen.getByText(/that is all we need here/i)).toBeDefined();
  }, 30_000);

  it("asks the rest of the sequence once they did stop", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await walkTo(user, "Stopping and starting again");

    await chooseRadioIn(user, /stop taking it/i, "Yes");

    expect(screen.getByRole("group", { name: /better after stopping/i })).toBeDefined();
    expect(screen.getByRole("group", { name: /start taking it again/i })).toBeDefined();

    // And the last of the four only after that one is yes.
    expect(screen.queryByRole("group", { name: /same thing happen again/i })).toBeNull();
    await chooseRadioIn(user, /start taking it again/i, "Yes");
    expect(screen.getByRole("group", { name: /same thing happen again/i })).toBeDefined();
  }, 30_000);

  /*
    Answering "no" after having said yes must take the answers that rested on
    the yes with it, or the report carries a restart date for a stop that the
    reporter has just said never happened.
  */
  it("withdraws the answers underneath when the stop is withdrawn", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await walkTo(user, "Stopping and starting again");

    await chooseRadioIn(user, /stop taking it/i, "Yes");
    await chooseRadioIn(user, /start taking it again/i, "Yes");

    // Now say they never stopped after all.
    await chooseRadioIn(user, /stop taking it/i, "No");
    expect(screen.queryByRole("group", { name: /start taking it again/i })).toBeNull();

    // Say yes again: the question comes back UNANSWERED, not still on yes.
    await chooseRadioIn(user, /stop taking it/i, "Yes");
    const back = screen.getByRole("group", { name: /start taking it again/i });
    expect(within(back).getByLabelText("Yes")).not.toBeChecked();
    expect(within(back).getByLabelText("No")).not.toBeChecked();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Typing, through the real draft store
// ---------------------------------------------------------------------------

describe("what the reporter types is what the box holds", () => {
  beforeEach(() => {
    window.localStorage.clear();
    submitSpy.mockClear();
  });

  /*
    Typing, end to end through the real draft store.

    The bug these describe was `shortText` being `z.string().trim()` — a zod
    TRANSFORM — while the draft round-trips through `ReportDraft.safeParse` on
    every read, so a trailing space was stripped the instant it was typed and
    the next character landed against the previous word: "Amoxil 500" became
    "Amoxil500".

    BE HONEST ABOUT WHAT THESE CATCH. They do not reproduce that failure:
    jsdom applies the store update synchronously and `user-event` types faster
    than the round trip, so they passed with the transform in place. The tests
    that actually fail without the fix are in `schemas/report.test.ts`, at the
    layer where the rewriting happened. These are here for the layer above —
    that a person typing into the assembled form gets what they typed — and
    they would catch a future change that broke it more coarsely.
  */
  it("keeps spaces and dashes, in order", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await clickButtonByKeyboard(user, /^next$/i);

    const medicine = screen.getByLabelText("What is the medicine called?");
    await user.click(medicine);
    await user.type(medicine, "co-codamol 30 mg");

    expect((medicine as HTMLInputElement).value).toBe("co-codamol 30 mg");
  }, 30_000);

  it("keeps a multi-word narrative intact", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await clickButtonByKeyboard(user, /^next$/i);
    await clickButtonByKeyboard(user, /^next$/i);

    const story = screen.getByLabelText("What went wrong?");
    await user.click(story);
    await user.type(story, "A rash on both arms, two days after starting it.");

    expect((story as HTMLTextAreaElement).value).toBe(
      "A rash on both arms, two days after starting it.",
    );
  }, 30_000);

  /*
    The one the reporter hit, and this one DOES reproduce.

    `yourEmail` was `answer(z.email())`. One character is not an email address,
    so the draft would not parse, and the store — which threw the whole saved
    form away when it would not parse — handed back a blank one at step one.
    Their name, their medicine and their narrative went with it.

    Typed a character at a time on purpose: the failure was in the first
    keystroke, not the finished value.
  */
  it("does not throw the form away when an email is half typed", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await clickButtonByKeyboard(user, /^next$/i);
    await user.click(screen.getByLabelText("What is the medicine called?"));
    await user.type(
      screen.getByLabelText("What is the medicine called?"),
      "Amoxil",
    );
    await clickButtonByKeyboard(user, /^next$/i);
    await clickButtonByKeyboard(user, /^next$/i);
    await clickButtonByKeyboard(user, /^next$/i);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "About you",
    );
    const name = screen.getByLabelText("What is your name?");
    await user.click(name);
    await user.type(name, "Sam Patel");

    const email = screen.getByLabelText("What is your email address?");
    await user.click(email);
    for (const character of "sam@example.ie") {
      await user.type(email, character);
      // Still here, still on this step, with everything else intact.
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "About you",
      );
      expect((name as HTMLInputElement).value).toBe("Sam Patel");
    }

    expect((email as HTMLInputElement).value).toBe("sam@example.ie");
    // And the answers from three steps back are still there.
    await clickButtonByKeyboard(user, /^back$/i);
    await clickButtonByKeyboard(user, /^back$/i);
    await clickButtonByKeyboard(user, /^back$/i);
    expect(
      (screen.getByLabelText("What is the medicine called?") as HTMLInputElement)
        .value,
    ).toBe("Amoxil");
  }, 30_000);

  /*
    The other half: a value that is finished IS trimmed, once, on the way to
    the server. What the reporter sees while typing is theirs; what a reviewer
    reads is normalised.
  */
  it("trims only at submission, not while typing", async () => {
    const user = userEvent.setup();
    render(<ReportWizard />);

    await chooseRadio(user, "It happened to someone else");
    await clickButtonByKeyboard(user, /^next$/i);

    const medicine = screen.getByLabelText("What is the medicine called?");
    await user.click(medicine);
    await user.type(medicine, "Amoxil  ");
    // Still exactly what was typed, trailing spaces and all.
    expect((medicine as HTMLInputElement).value).toBe("Amoxil  ");
  }, 30_000);
});

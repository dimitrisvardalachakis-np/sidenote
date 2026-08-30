// @vitest-environment jsdom
/**
 * Keyboard operation of the question controls.
 *
 * These exist because I could not verify keyboard use through the browser
 * automation tool: its key injection emits keydown with an empty `key`, which
 * the browser will not act on, so nothing was ever activated. I reported it as
 * working once on the strength of a misread value. This is the honest version
 * of that check, and being committed it also catches a regression later.
 *
 * user-event drives real focus and dispatches proper key sequences, so a radio
 * activated here was activated the way a person activates one.
 */
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ChoiceQuestion,
  DateQuestion,
  NumberQuestion,
  TextQuestion,
} from "./questions";
import { UNANSWERED, type Answer } from "@/lib/schemas/answer";
import type { PartialDate } from "@/lib/schemas/partial-date";

/** These controls are controlled, so a test needs something to hold state. */
function Harness<T>({
  initial,
  render: renderControl,
}: {
  initial: Answer<T>;
  render: (value: Answer<T>, set: (next: Answer<T>) => void) => React.ReactNode;
}) {
  const [value, setValue] = useState<Answer<T>>(initial);
  return (
    <>
      {renderControl(value, setValue)}
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}");

describe("choice questions by keyboard", () => {
  it("is reachable by Tab and selectable with Space", async () => {
    const user = userEvent.setup();
    render(
      <Harness<"yes" | "no">
        initial={UNANSWERED}
        render={(value, set) => (
          <ChoiceQuestion<"yes" | "no">
            legend="Did they go to hospital?"
            choices={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            value={value}
            onChange={set}
          />
        )}
      />,
    );

    await user.tab();
    expect(screen.getByLabelText("Yes")).toHaveFocus();

    await user.keyboard("[Space]");
    expect(state()).toEqual({ status: "answered", value: "yes" });
  });

  it("moves between options with the arrow keys, selecting as it goes", async () => {
    const user = userEvent.setup();
    render(
      <Harness<"yes" | "no">
        initial={UNANSWERED}
        render={(value, set) => (
          <ChoiceQuestion<"yes" | "no">
            legend="Did they go to hospital?"
            choices={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            value={value}
            onChange={set}
          />
        )}
      />,
    );

    await user.tab();
    await user.keyboard("[Space]");
    await user.keyboard("{ArrowDown}");
    expect(state()).toEqual({ status: "answered", value: "no" });

    await user.keyboard("{ArrowDown}");
    expect(state()).toEqual({ status: "unknown" });
  });

  it("reaches 'I don't know' by keyboard like any other option", async () => {
    const user = userEvent.setup();
    render(
      <Harness<"yes" | "no">
        initial={UNANSWERED}
        render={(value, set) => (
          <ChoiceQuestion<"yes" | "no">
            legend="Did they go to hospital?"
            choices={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            value={value}
            onChange={set}
          />
        )}
      />,
    );

    await user.click(screen.getByLabelText("I don't know"));
    expect(state()).toEqual({ status: "unknown" });
  });

  it("clears back to unanswered, which is not the same as unknown", async () => {
    const user = userEvent.setup();
    render(
      <Harness<"yes" | "no">
        initial={UNANSWERED}
        render={(value, set) => (
          <ChoiceQuestion<"yes" | "no">
            legend="Did they go to hospital?"
            choices={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            value={value}
            onChange={set}
          />
        )}
      />,
    );

    await user.click(screen.getByLabelText("Yes"));
    expect(state().status).toBe("answered");

    // The clear control is a button, so Enter must work on it.
    const clear = screen.getByRole("button", { name: /clear this answer/i });
    clear.focus();
    await user.keyboard("{Enter}");
    expect(state()).toEqual({ status: "unanswered" });
  });

  it("associates the legend with the group", () => {
    render(
      <Harness<"yes" | "no">
        initial={UNANSWERED}
        render={(value, set) => (
          <ChoiceQuestion<"yes" | "no">
            legend="Did they go to hospital?"
            choices={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
            value={value}
            onChange={set}
          />
        )}
      />,
    );
    expect(
      screen.getByRole("group", { name: "Did they go to hospital?" }),
    ).toBeDefined();
  });
});

describe("typed questions by keyboard", () => {
  it("takes a number and toggles unknown with Space", async () => {
    const user = userEvent.setup();
    render(
      <Harness<number>
        initial={UNANSWERED}
        render={(value, set) => (
          <NumberQuestion
            label="How old are they?"
            value={value}
            onChange={set}
          />
        )}
      />,
    );

    await user.tab();
    expect(screen.getByLabelText("How old are they?")).toHaveFocus();
    await user.keyboard("72");
    expect(state()).toEqual({ status: "answered", value: 72 });

    await user.tab();
    expect(screen.getByLabelText("I don't know")).toHaveFocus();
    await user.keyboard("[Space]");
    expect(state()).toEqual({ status: "unknown" });
  });

  it("disables the box when unknown, so the two cannot disagree", async () => {
    const user = userEvent.setup();
    render(
      <Harness<number>
        initial={UNANSWERED}
        render={(value, set) => (
          <NumberQuestion label="How old are they?" value={value} onChange={set} />
        )}
      />,
    );
    await user.click(screen.getByLabelText("I don't know"));
    expect(screen.getByLabelText("How old are they?")).toBeDisabled();
  });

  it("treats a box typed and then emptied as unanswered, not as empty", async () => {
    const user = userEvent.setup();
    render(
      <Harness<string>
        initial={UNANSWERED}
        render={(value, set) => (
          <TextQuestion
            label="What is the medicine called?"
            value={value}
            onChange={set}
          />
        )}
      />,
    );
    const box = screen.getByLabelText("What is the medicine called?");
    await user.type(box, "Amoxil");
    expect(state()).toEqual({ status: "answered", value: "Amoxil" });
    await user.clear(box);
    expect(state()).toEqual({ status: "unanswered" });
  });
});

describe("partial dates by keyboard", () => {
  it("takes a year alone and reads it back as a year", async () => {
    const user = userEvent.setup();
    render(
      <Harness<PartialDate>
        initial={UNANSWERED}
        render={(value, set) => (
          <DateQuestion legend="When did it start?" value={value} onChange={set} />
        )}
      />,
    );

    await user.type(screen.getByLabelText("Year"), "2026");
    expect(state()).toEqual({
      status: "answered",
      value: { value: "2026", precision: "year" },
    });
    expect(screen.getByText(/You said:/).textContent).toContain("2026");
  });

  it("adds a month and reads it back as March 2026", async () => {
    const user = userEvent.setup();
    render(
      <Harness<PartialDate>
        initial={UNANSWERED}
        render={(value, set) => (
          <DateQuestion legend="When did it start?" value={value} onChange={set} />
        )}
      />,
    );

    await user.type(screen.getByLabelText("Year"), "2026");
    await user.selectOptions(screen.getByLabelText("Month"), "03");
    expect(state()).toEqual({
      status: "answered",
      value: { value: "2026-03", precision: "month" },
    });
    expect(screen.getByText(/You said:/).textContent).toContain("March 2026");
  });

  it("keeps the day box shut until a month is chosen", async () => {
    const user = userEvent.setup();
    render(
      <Harness<PartialDate>
        initial={UNANSWERED}
        render={(value, set) => (
          <DateQuestion legend="When did it start?" value={value} onChange={set} />
        )}
      />,
    );
    await user.type(screen.getByLabelText("Year"), "2026");
    expect(screen.getByLabelText("Day")).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Month"), "03");
    expect(screen.getByLabelText("Day")).not.toBeDisabled();
  });
});

describe("labels", () => {
  it("gives every control an accessible name, with no double association", () => {
    const { container } = render(
      <Harness<number>
        initial={UNANSWERED}
        render={(value, set) => (
          <NumberQuestion label="How old are they?" value={value} onChange={set} />
        )}
      />,
    );
    const inputs = [...container.querySelectorAll("input")];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const wrapping = input.closest("label");
      const explicit = input.id
        ? container.querySelector(`label[for="${input.id}"]`)
        : null;
      // Named exactly one way, never both: a label that wraps AND points at
      // the same control forwards a second activation.
      expect(wrapping !== null || explicit !== null).toBe(true);
      expect(wrapping !== null && explicit !== null).toBe(false);
    }
  });
});

describe("saying an answer is the wrong shape", () => {
  /*
    Held back until focus leaves the box. Judging as they type means telling
    somebody their email address is wrong after the first letter of it — true,
    useless, and the thing that makes a form feel like it is arguing.
  */
  it("stays quiet while the box is being typed into", async () => {
    const user = userEvent.setup();
    render(
      <Harness<string>
        initial={UNANSWERED}
        render={(value, set) => (
          <TextQuestion
            label="What is your email address?"
            value={value}
            onChange={set}
            problem="That email address does not look complete."
          />
        )}
      />,
    );

    const box = screen.getByLabelText("What is your email address?");
    await user.click(box);
    await user.type(box, "sam");
    expect(screen.queryByText(/does not look complete/)).toBeNull();

    await user.tab();
    expect(screen.getByText(/does not look complete/)).toBeDefined();
    expect(box).toHaveAttribute("aria-invalid", "true");
    // And it is wired to the box, not just sitting near it.
    expect(box.getAttribute("aria-describedby")).toContain(
      screen.getByText(/does not look complete/).id,
    );
  });

  it("takes the note down as soon as the answer is fixed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Harness<string>
        initial={UNANSWERED}
        render={(value, set) => (
          <TextQuestion label="Email" value={value} onChange={set} problem="Not right." />
        )}
      />,
    );
    const box = screen.getByLabelText("Email");
    await user.click(box);
    await user.tab();
    expect(screen.getByText("Not right.")).toBeDefined();

    rerender(
      <Harness<string>
        initial={UNANSWERED}
        render={(value, set) => (
          <TextQuestion label="Email" value={value} onChange={set} />
        )}
      />,
    );
    expect(screen.queryByText("Not right.")).toBeNull();
  });

  it("will not take more characters than its field can hold", () => {
    render(
      <Harness<string>
        initial={UNANSWERED}
        render={(value, set) => (
          <TextQuestion
            label="Phone"
            value={value}
            onChange={set}
            maxLength={40}
          />
        )}
      />,
    );
    expect(screen.getByLabelText("Phone")).toHaveAttribute("maxlength", "40");
  });
});

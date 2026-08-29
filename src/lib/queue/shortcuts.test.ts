import { describe, expect, it } from "vitest";
import { isTypingTarget, queueShortcut, type KeyContext } from "./shortcuts";

const base: KeyContext = {
  key: "j",
  withModifier: false,
  inField: false,
  dialogOpen: false,
  hasRows: true,
};

const press = (over: Partial<KeyContext>) => queueShortcut({ ...base, ...over });

describe("moving and opening", () => {
  it("moves down on j and the down arrow", () => {
    expect(press({ key: "j" })).toEqual({ kind: "move", delta: 1 });
    expect(press({ key: "ArrowDown" })).toEqual({ kind: "move", delta: 1 });
  });

  it("moves up on k and the up arrow", () => {
    expect(press({ key: "k" })).toEqual({ kind: "move", delta: -1 });
    expect(press({ key: "ArrowUp" })).toEqual({ kind: "move", delta: -1 });
  });

  it("opens on Enter", () => {
    expect(press({ key: "Enter" })).toEqual({ kind: "open" });
  });

  it("does nothing to an empty list", () => {
    expect(press({ key: "j", hasRows: false })).toEqual({ kind: "none" });
    expect(press({ key: "Enter", hasRows: false })).toEqual({ kind: "none" });
  });

  it("focuses the search on slash and toggles help on question mark", () => {
    expect(press({ key: "/" })).toEqual({ kind: "focus_search" });
    expect(press({ key: "?" })).toEqual({ kind: "toggle_help" });
  });

  it("ignores keys it does not own", () => {
    expect(press({ key: "a" })).toEqual({ kind: "none" });
    expect(press({ key: "Tab" })).toEqual({ kind: "none" });
  });
});

describe("standing down", () => {
  /*
    THE bug a global key listener ships with. A reviewer typing "see 4.8/4.9"
    into a ruling rationale must keep their slash, and somebody writing "just
    a rash" must keep their j.
  */
  it("never acts while somebody is typing", () => {
    for (const key of ["j", "k", "/", "?", "Enter", "ArrowDown"]) {
      expect(press({ key, inField: true })).toEqual({ kind: "none" });
    }
  });

  it("hands Escape to the field, because the field is the search box", () => {
    expect(press({ key: "Escape", inField: true })).toEqual({ kind: "dismiss" });
  });

  it("never acts while a dialog is open, Escape included", () => {
    for (const key of ["j", "/", "?", "Escape", "Enter"]) {
      expect(press({ key, dialogOpen: true })).toEqual({ kind: "none" });
    }
  });

  it("never acts when a modifier is held", () => {
    for (const key of ["j", "k", "/", "?", "Enter"]) {
      expect(press({ key, withModifier: true })).toEqual({ kind: "none" });
    }
  });
});

describe("isTypingTarget", () => {
  it("recognises the elements a person types into", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not mistake an ordinary element for one", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget({ tagName: "A" })).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

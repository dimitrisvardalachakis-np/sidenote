/**
 * Who the report is about decides every pronoun after step 1.
 *
 * One helper, used everywhere. The alternative is writing each question twice
 * ("Did you go to hospital?" / "Did they go to hospital?") which doubles the
 * copy, doubles the places a change has to land, and guarantees the two drift.
 */
import { z } from "zod";

export const ReportAbout = z.enum(["self", "someone_else"]);
export type ReportAbout = z.output<typeof ReportAbout>;

export interface Pronouns {
  /** "you" / "they" — the one doing something. */
  readonly subject: string;
  /** "you" / "them" — the one something is done to. */
  readonly object: string;
  /** "your" / "their" */
  readonly possessive: string;
  /** "yourself" / "themselves" */
  readonly reflexive: string;
  /** "you were" / "they were" — kept as a phrase so it is never mis-conjugated. */
  readonly wereTaking: string;
  /** How to name the person in a heading. */
  readonly personLabel: string;
}

const SELF: Pronouns = {
  subject: "you",
  object: "you",
  possessive: "your",
  reflexive: "yourself",
  wereTaking: "you were taking",
  personLabel: "you",
};

const OTHER: Pronouns = {
  subject: "they",
  object: "them",
  possessive: "their",
  reflexive: "themselves",
  wereTaking: "they were taking",
  personLabel: "the person you are reporting about",
};

export function pronounsFor(about: ReportAbout): Pronouns {
  return about === "self" ? SELF : OTHER;
}

/** Capitalise a pronoun that has landed at the start of a sentence. */
export function cap(word: string): string {
  const first = word.slice(0, 1);
  return first === "" ? word : first.toUpperCase() + word.slice(1);
}

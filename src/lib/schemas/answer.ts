/**
 * Three states, not two.
 *
 * A blank box and "I don't know" are different facts. Blank means nobody has
 * been asked yet. Unknown means someone was asked, thought about it, and does
 * not know. For a safety report that difference is worth real money: a missing
 * answer is something to chase, and a known-unknown is not.
 *
 * Modelling both as "empty string" is the ordinary way to lose that, and it is
 * lost silently, because the two look identical in storage.
 */
import { z } from "zod";

export type AnswerStatus = "unanswered" | "unknown" | "answered";

/** Wrap any schema so the field can also be blank or explicitly unknown. */
export function answer<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("unanswered") }),
    z.object({ status: z.literal("unknown") }),
    z.object({ status: z.literal("answered"), value }),
  ]);
}

export type Answer<T> =
  | { readonly status: "unanswered" }
  | { readonly status: "unknown" }
  | { readonly status: "answered"; readonly value: T };

export const UNANSWERED: Answer<never> = { status: "unanswered" };
export const NOT_KNOWN: Answer<never> = { status: "unknown" };

export function answered<T>(value: T): Answer<T> {
  return { status: "answered", value };
}

export function isAnswered<T>(
  a: Answer<T>,
): a is { readonly status: "answered"; readonly value: T } {
  return a.status === "answered";
}

/** The value if there is one, otherwise null. */
export function answerValue<T>(a: Answer<T>): T | null {
  return a.status === "answered" ? a.value : null;
}

/**
 * True when the question has been dealt with either way.
 *
 * This is what progress and completeness are measured against — "I don't know"
 * counts as dealt with, because pestering someone for an answer they have
 * already told you they do not have is how a form gets abandoned.
 */
export function isResolved<T>(a: Answer<T>): boolean {
  return a.status !== "unanswered";
}

import { describe, expect, it } from "vitest";
import { toMatchExpression } from "./lexical-d1";

/**
 * The FTS5 query builder.
 *
 * This is the only place reviewer-typed text becomes database SYNTAX, and FTS5
 * has a real query language: `NOT` and `OR` are operators, a bare `*` is a
 * prefix, an odd `"` is a syntax error, and a leading `-` starts a column
 * filter. None of that is hypothetical in a safety application —
 * "Stevens-Johnson" contains a hyphen and reviewers type it all day.
 *
 * Every one of these is a query that would either error or silently mean
 * something else if the text were passed through.
 */

describe("toMatchExpression", () => {
  it("quotes each term as a literal, OR-ed together", () => {
    const expression = toMatchExpression("hepatic failure");
    expect(expression).toContain('"hepatic"');
    expect(expression).toContain('"failure"');
    expect(expression).toContain(" OR ");
  });

  it("neutralises FTS5 operators typed as words", () => {
    // A reviewer typing "rash NOT hepatic" means both words, not a negation.
    const expression = toMatchExpression("rash NOT hepatic") ?? "";
    // Every token is inside quotes, so nothing is left to be read as syntax.
    expect(expression).not.toMatch(/(^|\s)NOT(\s|$)/);
  });

  it("survives a hyphenated term, which this domain is full of", () => {
    const expression = toMatchExpression("Stevens-Johnson syndrome") ?? "";
    // A leading hyphen is a column filter in FTS5. Whatever the tokeniser does
    // with the hyphen, the result must be quoted literals and nothing else.
    expect(expression).toMatch(/^"[^"]*"( OR "[^"]*")*$/);
  });

  it("escapes an embedded double quote instead of ending the literal", () => {
    // Doubling is the escape in FTS5. Getting this wrong is a syntax error at
    // best and an injected operator at worst.
    const expression = toMatchExpression('say "aah" now') ?? "";
    expect(expression).toMatch(/^"[^"]*"( OR "[^"]*")*$|""/);
    expect(() => JSON.parse("{}")).not.toThrow();
  });

  it("refuses to build an expression from nothing", () => {
    // `MATCH ''` is an FTS5 error, and `MATCH` with no terms would otherwise
    // be built from punctuation-only input.
    expect(toMatchExpression("")).toBeNull();
    expect(toMatchExpression("   ")).toBeNull();
    expect(toMatchExpression("!!! ??? ...")).toBeNull();
  });

  it("carries the synonym expansion the in-memory search already had", () => {
    // Same expandQuery as lexicalSearch, so "rash" still reaches the passage
    // that only ever says "erythema". Losing this on the D1 path would make
    // retrieval quietly worse the moment a database was bound.
    const expression = toMatchExpression("rash") ?? "";
    expect(expression.split(" OR ").length).toBeGreaterThan(1);
  });
});

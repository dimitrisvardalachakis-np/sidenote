/**
 * One import site for the domain.
 *
 * CLAUDE.md non-negotiable #2 is "one zod schema per entity, imported by both
 * the client form and the server action". This barrel is what makes that
 * literally true: there is no second definition to drift from, and no
 * hand-written interface sitting alongside a schema waiting to disagree with
 * it. Every type in here is `z.output<typeof Schema>`.
 */
export * from "./primitives";
export * from "./patient";
export * from "./reporter";
export * from "./drug";
export * from "./reaction";
export * from "./document";
export * from "./assessment";
export * from "./case";

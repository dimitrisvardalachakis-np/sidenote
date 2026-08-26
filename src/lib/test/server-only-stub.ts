/**
 * Stands in for the `server-only` package under Vitest.
 *
 * The real module throws on import so that a server module pulled into a
 * client bundle fails loudly. Next enforces that at build time via the
 * react-server export condition; a unit test is neither a server nor a client
 * bundle, so importing the real thing would fail every test of every module
 * that correctly marks itself server-only.
 */
export {};

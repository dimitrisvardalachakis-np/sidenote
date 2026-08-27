/**
 * fetchJson — the only way SideNote is allowed to turn a network response
 * into a typed value.
 *
 * The rule this file exists to enforce is CLAUDE.md non-negotiable #3:
 * every AI output carries citations, and no citation means no claim
 * rendered. A rule like that is only real if it is checked against the
 * bytes that actually arrived. `as T` checks nothing, so `as T` cannot
 * enforce it. A zod schema can, which is why the schema is a required
 * argument rather than an optional convenience.
 *
 * Web APIs only — fetch, Response, AbortSignal. No Node imports, so this
 * runs unchanged on Workers in Cluster C.
 */
import { z } from "zod";

/**
 * The four distinct ways a JSON fetch can fail. These are kept apart
 * because the reviewer UI has to tell them apart: CLAUDE.md non-negotiable
 * #5 says AI failure must never block a human write, and an honest degraded
 * state means saying "the label service is unreachable" rather than
 * "something went wrong".
 */
export type FetchFailureKind =
  | "network" // never reached the server, or the caller aborted
  | "http" // reached it; it answered with a non-2xx status
  | "malformed-json" // answered 2xx, but the body was not JSON
  | "schema-mismatch"; // valid JSON, wrong shape — the dangerous one

/** Base class so a caller can catch every fetchJson failure in one clause. */
export class FetchJsonError extends Error {
  readonly kind: FetchFailureKind;
  readonly url: string;

  constructor(
    kind: FetchFailureKind,
    message: string,
    url: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FetchJsonError";
    this.kind = kind;
    this.url = url;
  }
}

/** The request never produced a response: DNS, TLS, offline, or aborted. */
export class NetworkError extends FetchJsonError {
  /** True when an AbortSignal fired — usually our own timeout. */
  readonly aborted: boolean;

  constructor(url: string, aborted: boolean, cause: unknown) {
    super(
      "network",
      aborted
        ? `Request to ${url} was aborted before a response arrived`
        : `Request to ${url} could not reach the server`,
      url,
      { cause },
    );
    this.name = "NetworkError";
    this.aborted = aborted;
  }
}

/**
 * The server answered with a non-2xx status. Carries the status and the raw
 * body, because an audit line that records only "it failed" is not an audit
 * line (non-negotiable #9).
 */
export class HttpError extends FetchJsonError {
  readonly status: number;
  readonly statusText: string;
  /** Raw response body, read as text. Empty string if there was none. */
  readonly body: string;
  /** The body re-parsed as JSON when it happened to be JSON, else undefined. */
  readonly bodyJson: unknown;

  constructor(
    url: string,
    status: number,
    statusText: string,
    body: string,
    bodyJson: unknown,
  ) {
    super(
      "http",
      `${status} ${statusText || "error"} from ${url}`.trim(),
      url,
    );
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.bodyJson = bodyJson;
  }
}

/** A 2xx response whose body was not parseable JSON — often an HTML error page. */
export class MalformedJsonError extends FetchJsonError {
  readonly body: string;

  constructor(url: string, body: string, cause: unknown) {
    super("malformed-json", `Response from ${url} was not valid JSON`, url, {
      cause,
    });
    this.name = "MalformedJsonError";
    this.body = body;
  }
}

/**
 * Valid JSON of the wrong shape. This is the failure `as T` would have let
 * through silently, and the one that would otherwise put an uncited claim
 * in front of a safety reviewer.
 */
export class SchemaMismatchError extends FetchJsonError {
  readonly error: z.ZodError;
  /** The value that failed, kept as `unknown` so it cannot be used unchecked. */
  readonly received: unknown;

  constructor(url: string, error: z.ZodError, received: unknown) {
    super(
      "schema-mismatch",
      `Response from ${url} did not match the expected schema`,
      url,
    );
    this.name = "SchemaMismatchError";
    this.error = error;
    this.received = received;
  }

  /** Human-readable issue list, for logs and the degraded-state panels. */
  prettify(): string {
    return z.prettifyError(this.error);
  }
}

/**
 * Fetch `url`, then prove the body matches `schema` before returning it.
 *
 * The return type is `z.output<S>` — derived from the schema argument, not
 * from a type parameter the caller supplies. That is the whole point: the
 * caller cannot name a type the data does not have.
 *
 * Timeouts are the caller's business and use the platform primitive:
 *   fetchJson(url, schema, { signal: AbortSignal.timeout(5_000) })
 *
 * @throws {NetworkError} no response arrived
 * @throws {HttpError} non-2xx status
 * @throws {MalformedJsonError} 2xx but unparseable
 * @throws {SchemaMismatchError} parsed, but the wrong shape
 */
export async function fetchJson<S extends z.ZodType>(
  url: string | URL,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  const href = typeof url === "string" ? url : url.toString();

  const headers = new Headers(init?.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (cause) {
    const aborted =
      cause instanceof Error &&
      (cause.name === "AbortError" || cause.name === "TimeoutError");
    throw new NetworkError(href, aborted, cause);
  }

  // Read the body exactly once, as text. A Response body is a single-use
  // stream, so committing to res.json() here would destroy the evidence
  // needed to explain a failure.
  let raw: string;
  try {
    raw = await res.text();
  } catch (cause) {
    throw new NetworkError(href, false, cause);
  }

  if (!res.ok) {
    // Best-effort structured detail for the audit line; a plaintext or HTML
    // error body is normal here and must not mask the real HTTP failure.
    const errBody = tryParseJson(raw);
    throw new HttpError(
      href,
      res.status,
      res.statusText,
      raw,
      errBody.ok ? errBody.value : undefined,
    );
  }

  // 204 and friends: hand the schema `undefined` so a caller expecting no
  // content can say so with z.undefined() instead of guessing.
  const parsed: JsonParseResult =
    raw.trim() === "" ? { ok: true, value: undefined } : tryParseJson(raw);
  if (!parsed.ok) {
    throw new MalformedJsonError(href, raw, parsed.cause);
  }

  const result = schema.safeParse(parsed.value);
  if (!result.success) {
    throw new SchemaMismatchError(href, result.error, parsed.value);
  }
  return result.data;
}

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly cause: unknown };

function tryParseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (cause) {
    return { ok: false, cause };
  }
}

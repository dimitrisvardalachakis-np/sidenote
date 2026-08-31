import { describe, expect, it } from "vitest";
import assessWorker from "../../../worker-ai/index";
import { ASSESS_SECRET_HEADER, ASSESS_ROUTE, AssessRequest } from "./wire";

/**
 * The AI Worker's front door.
 *
 * Its inside is `assessCase`, which is already the most heavily tested thing
 * in the repository. What is new — and what a service binding makes worth
 * testing — is the door: who is let in, in what order the checks happen, and
 * what a misconfigured deployment does.
 *
 * Imported directly rather than driven over a binding, because a `services`
 * binding needs two deployed Workers. That limit is real and is stated in the
 * commit rather than papered over: nothing here proves the binding resolves.
 */
function post(
  body: unknown,
  headers: Record<string, string> = {},
  path = ASSESS_ROUTE,
): Request {
  return new Request(`https://assess.invalid${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const CONFIGURED = { SIDENOTE_ASSESS_SECRET: "s3cret" } as unknown as CloudflareEnv;

describe("who is let in", () => {
  it("refuses everything when no secret is configured", async () => {
    const response = await assessWorker.fetch(
      post({}, { [ASSESS_SECRET_HEADER]: "anything" }),
      {} as CloudflareEnv,
    );

    // Serving inference to anyone because the secret was never set is worse
    // than serving nobody, so being misconfigured fails closed.
    expect(response.status).toBe(503);
  });

  it("refuses a request with no secret", async () => {
    const response = await assessWorker.fetch(post({}), CONFIGURED);
    expect(response.status).toBe(401);
  });

  it("refuses a request with the wrong secret", async () => {
    const response = await assessWorker.fetch(
      post({}, { [ASSESS_SECRET_HEADER]: "s3cres" }),
      CONFIGURED,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a wrong secret of a different length without comparing further", async () => {
    const response = await assessWorker.fetch(
      post({}, { [ASSESS_SECRET_HEADER]: "s" }),
      CONFIGURED,
    );
    expect(response.status).toBe(401);
  });

  it("checks the secret before it looks at the body", async () => {
    // A body that would fail parsing. An unauthenticated caller must not be
    // able to make this Worker do the work of rejecting a megabyte of JSON,
    // and the 400 would also tell them their secret had been accepted.
    const response = await assessWorker.fetch(
      post({ chunks: "not an array" }),
      CONFIGURED,
    );
    expect(response.status).toBe(401);
  });

  it("serves nothing on another route or method", async () => {
    expect(
      (await assessWorker.fetch(post({}, {}, "/"), CONFIGURED)).status,
    ).toBe(404);
    expect(
      (
        await assessWorker.fetch(
          new Request(`https://assess.invalid${ASSESS_ROUTE}`),
          CONFIGURED,
        )
      ).status,
    ).toBe(404);
  });

  it("rejects a malformed body once the secret is right", async () => {
    const response = await assessWorker.fetch(
      post({ chunks: "not an array" }, { [ASSESS_SECRET_HEADER]: "s3cret" }),
      CONFIGURED,
    );
    expect(response.status).toBe(400);
  });
});

describe("the contract both sides parse", () => {
  it("refuses a request that widens scope to every document", () => {
    // `documentIds` is the scope decision, made by the app before anything
    // crosses. A malformed one must not become "no filter".
    const parsed = AssessRequest.safeParse({
      chunks: [],
      documentIds: ["not-a-uuid"],
      reactionTerm: "hepatic failure",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: null,
      now: "2026-08-25T10:00:00.000Z",
      actor: "reviewer-demo",
      target: "SN-2026-000101",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a request with no reaction to search for", () => {
    const parsed = AssessRequest.safeParse({
      chunks: [],
      documentIds: [],
      reactionTerm: "",
      drugName: "Hepalex",
      documentKind: "ccds",
      labelSetId: null,
      now: "2026-08-25T10:00:00.000Z",
      actor: "reviewer-demo",
      target: "SN-2026-000101",
    });
    expect(parsed.success).toBe(false);
  });
});

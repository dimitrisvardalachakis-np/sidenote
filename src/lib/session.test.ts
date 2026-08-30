import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate itself: does an unauthenticated browser get in?
 *
 * This is the test the earlier design could not have passed, because it was
 * built the other way round — the cookie was written on sign-OUT, so absence
 * meant signed in and a browser that had never been here reached the queue.
 * That was defensible while sign-in was one button with nothing to type. It
 * stopped being defensible the moment there was a password to get past.
 *
 * `next/headers` is mocked because a cookie jar is the one thing these
 * functions genuinely need and Next only supplies it inside a request.
 */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const { SESSION_COOKIE, endSession, getSession, startSession } = await import(
  "./auth"
);

beforeEach(() => {
  jar.clear();
});

describe("getSession", () => {
  it("is null for a browser that has never been here", async () => {
    expect(await getSession()).toBeNull();
  });

  it("is the reviewer the session was started for", async () => {
    await startSession("reviewer-ao");
    expect((await getSession())?.displayName).toBe("A. Okonkwo");
  });

  it("is null again after signing out", async () => {
    await startSession("reviewer-demo");
    await endSession();
    expect(await getSession()).toBeNull();
  });

  it("refuses a cookie nobody signed", async () => {
    // What anyone able to set a header would try first.
    jar.set(SESSION_COOKIE, "reviewer-demo");
    expect(await getSession()).toBeNull();
    jar.set(SESSION_COOKIE, "reviewer-demo.not-a-real-signature");
    expect(await getSession()).toBeNull();
  });

  it("refuses a valid signature over a different identity", async () => {
    await startSession("reviewer-demo");
    const signed = jar.get(SESSION_COOKIE) ?? "";
    const mac = signed.slice(signed.lastIndexOf(".") + 1);
    // The signature is over the id, so moving it to another id must not verify.
    jar.set(SESSION_COOKIE, `reviewer-ao.${mac}`);
    expect(await getSession()).toBeNull();
  });

  it("refuses an identity that is not one of ours, however well signed", async () => {
    await startSession("reviewer-invented");
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await getSession()).toBeNull();
  });
});

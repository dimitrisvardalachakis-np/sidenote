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

/**
 * THE SECRET ROTATION DRILL.
 *
 * Cluster F asks for a rotation done wrong first, so the breakage is seen
 * rather than described, and then done right. Both halves are here, because a
 * dual-key window is one of those mechanisms that looks obviously correct and
 * is obviously correct only until somebody deletes the second key.
 *
 * The wrong way is one line: change the key. Every cookie in the wild was
 * signed with the old one, every signature check fails, and every reviewer is
 * signed out at once — including the one holding a case with a 15-day clock
 * running, who now has to sign in again to release it.
 */
describe("rotating the session secret", () => {
  it("signs everybody out when the key is swapped with no window", async () => {
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-one");
    await startSession("reviewer-demo");
    expect(await getSession()).not.toBeNull();

    // The mistake, in full: the new key replaces the old one and nothing
    // remembers the old one existed.
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-two");

    // The cookie is still in the jar and still perfectly well formed. It is
    // just signed with a key nothing will verify against any more.
    expect(await getSession()).toBeNull();
    vi.unstubAllEnvs();
  });

  it("keeps existing sessions alive across a dual-key window", async () => {
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-one");
    await startSession("reviewer-demo");

    // The right way. Deploy the CONSUMER first: the new key signs, the old one
    // is still accepted. Nobody notices anything.
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-two");
    vi.stubEnv("SIDENOTE_SESSION_SECRET_PREVIOUS", "key-one");

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.reviewerId).toBe("reviewer-demo");
    vi.unstubAllEnvs();
  });

  it("issues new cookies under the new key only", async () => {
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-two");
    vi.stubEnv("SIDENOTE_SESSION_SECRET_PREVIOUS", "key-one");
    await startSession("reviewer-demo");

    /*
      The half that makes the window closeable.

      If new cookies were signed with the old key too, retiring it would break
      sessions created DURING the window and the rotation would never finish.
      Dropping the previous key must be a no-op for anyone who signed in after
      the new key went live — so here the previous key is retired and the
      cookie minted a moment ago still verifies.
    */
    vi.stubEnv("SIDENOTE_SESSION_SECRET_PREVIOUS", "");
    expect(await getSession()).not.toBeNull();
    vi.unstubAllEnvs();
  });

  it("refuses a cookie signed with a key that was never ours", async () => {
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-one");
    await startSession("reviewer-demo");

    // Neither the current key nor the previous one. A forged cookie does not
    // become valid just because a rotation happens to be in progress.
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "key-two");
    vi.stubEnv("SIDENOTE_SESSION_SECRET_PREVIOUS", "key-three");

    expect(await getSession()).toBeNull();
    vi.unstubAllEnvs();
  });
});

/**
 * THE PRODUCTION SECRET GUARD, and the blast radius it must not have.
 *
 * Refusing the published default key in production is the point. Taking the
 * public report form down with it is not — a patient reporting a reaction has
 * nothing to do with our reviewer session config, and an outage there loses
 * safety data. So the throw has to be reachable only on the paths that
 * actually sign or verify something.
 */
describe("the production secret guard", () => {
  it("does not touch a visitor who has no cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "");

    // No cookie means no signature to check, so no secret is needed. This is
    // every public page: the form, the chat, the lookup.
    await expect(getSession()).resolves.toBeNull();
    vi.unstubAllEnvs();
  });

  it("refuses to mint a session rather than signing with the published key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "");

    /*
      Loud, not silent. The alternative this replaced was worse in the exact
      way that matters: it worked, and it signed with a key printed in this
      repository, so anyone who had read the file could mint a reviewer
      session and the deployment looked healthy.
    */
    await expect(startSession("reviewer-demo")).rejects.toThrow(
      /SIDENOTE_SESSION_SECRET/,
    );
    vi.unstubAllEnvs();
  });

  it("still runs on the default key outside production", async () => {
    vi.stubEnv("SIDENOTE_SESSION_SECRET", "");
    await startSession("reviewer-demo");
    expect(await getSession()).not.toBeNull();
    vi.unstubAllEnvs();
  });
});

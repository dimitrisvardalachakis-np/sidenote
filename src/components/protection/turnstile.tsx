"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The client half of the Turnstile gate.
 *
 * Kept as a hook rather than a self-contained widget because the token is not
 * the widget's business — it belongs to whatever is being submitted, and both
 * public surfaces (the five-step form and the intake chat) need to hold it,
 * disable their send button until it exists, and get a fresh one afterwards.
 *
 * A TURNSTILE TOKEN IS SINGLE USE. siteverify answers `timeout-or-duplicate`
 * the second time it sees one, so a chat that sends many messages cannot solve
 * the challenge once and reuse it. reset() asks the widget for a new token,
 * and the callers call it after every send.
 *
 * When `siteKey` is null there is no Turnstile configured, no script is
 * loaded, and status is "disabled" — the server side is the UnprotectedBotGate
 * in that case, and the two halves agree by both reading the same settings.
 */

interface TurnstileRenderOptions {
  readonly sitekey: string;
  readonly callback?: (token: string) => void;
  readonly "error-callback"?: () => void;
  readonly "expired-callback"?: () => void;
  readonly "timeout-callback"?: () => void;
  readonly theme?: "light" | "dark" | "auto";
  readonly appearance?: "always" | "execute" | "interaction-only";
}

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: TurnstileRenderOptions,
  ): string | undefined;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

export type TurnstileStatus =
  /** No site key configured. Nothing rendered, nothing required. */
  | "disabled"
  /** Script or widget still coming up. */
  | "loading"
  /** Widget rendered. `token` is null until the challenge is solved. */
  | "ready"
  /** Script would not load, or the widget reported an error. */
  | "error";

/** Loaded once per document, however many hooks ask for it. */
function loadScript(): Promise<void> {
  if (window.turnstile !== undefined) return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID);
  if (existing instanceof HTMLScriptElement) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("load failed")));
    document.head.appendChild(script);
  });
}

export interface Turnstile {
  /** Attach to the element the widget should render into. */
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly status: TurnstileStatus;
  /** The solved token, or null. Send this with the submission. */
  readonly token: string | null;
  /** Ask for a fresh token. Call after every send — tokens are single use. */
  readonly reset: () => void;
}

export function useTurnstile(siteKey: string | null): Turnstile {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  /**
   * Only meaningful while a site key exists. "disabled" is DERIVED below
   * rather than written from the effect: a setState in an effect body causes a
   * cascading render and the React Compiler lint rejects it outright — the
   * same finding that shaped ThemeToggle in Cluster A step 4. The two
   * setState calls that remain live in async continuations, which is the
   * "subscribe to an external system" case the rule exists to allow.
   */
  const [liveStatus, setLiveStatus] = useState<Exclude<TurnstileStatus, "disabled">>(
    "loading",
  );
  const [token, setToken] = useState<string | null>(null);

  const status: TurnstileStatus = siteKey === null ? "disabled" : liveStatus;

  useEffect(() => {
    if (siteKey === null) return;

    let cancelled = false;

    loadScript()
      .then(() => {
        const api = window.turnstile;
        const container = containerRef.current;
        // Both can legitimately be absent after an await: the component may
        // have unmounted, and the script may have loaded without defining the
        // global if something intercepted it.
        if (cancelled || api === undefined || container === null) return;

        const id = api.render(container, {
          sitekey: siteKey,
          callback: (solved: string) => {
            if (!cancelled) setToken(solved);
          },
          // Expiry clears the token rather than leaving a stale one to be sent
          // and rejected as `timeout-or-duplicate`, which would read to the
          // reporter as "you look like a robot".
          "expired-callback": () => {
            if (!cancelled) setToken(null);
          },
          "timeout-callback": () => {
            if (!cancelled) setToken(null);
          },
          "error-callback": () => {
            if (!cancelled) {
              setToken(null);
              setLiveStatus("error");
            }
          },
          theme: "auto",
        });

        if (cancelled) {
          if (id !== undefined) api.remove(id);
          return;
        }
        widgetIdRef.current = id ?? null;
        setLiveStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setLiveStatus("error");
      });

    return () => {
      cancelled = true;
      const api = window.turnstile;
      const id = widgetIdRef.current;
      if (api !== undefined && id !== null) api.remove(id);
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  const reset = useCallback(() => {
    setToken(null);
    const api = window.turnstile;
    const id = widgetIdRef.current;
    if (api !== undefined && id !== null) api.reset(id);
  }, []);

  return { containerRef, status, token, reset };
}

/**
 * The bit that goes on the page.
 *
 * Renders nothing at all when Turnstile is not configured — not an empty box,
 * not a placeholder. A visible slot where a security control is not running is
 * the same lie UnprotectedBotGate is named to avoid.
 *
 * `status` and `containerRef` are separate props rather than one `Turnstile`
 * object, and that is not tidiness. Reading `turnstile.status` off a value
 * that also carries a ref makes the React Compiler treat the whole object as a
 * ref and reject the read during render — correctly, in spirit: a component
 * should not be deciding what to draw from something ref-shaped. Splitting
 * them says which half is render state and which half is an escape hatch.
 *
 * IMPORTANT: on the chat surface this must sit INSIDE the <form>. Turnstile's
 * render() injects the hidden `cf-turnstile-response` input into this
 * container, and FormData only collects fields inside the form being
 * submitted. Outside it, the token silently never arrives.
 */
export function TurnstileWidget({
  status,
  containerRef,
}: {
  readonly status: TurnstileStatus;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (status === "disabled") return null;

  return (
    <div className="mt-4">
      <div ref={containerRef} />
      {status === "loading" ? (
        <p className="mt-2 text-meta text-slate">Checking your browser.</p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 text-meta text-ink">
          We could not load the check that tells us you are a person. Please
          reload the page. Your answers are saved.
        </p>
      ) : null}
    </div>
  );
}

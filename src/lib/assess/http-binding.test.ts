/**
 * The HTTP client is the piece that decides whether any of the generation
 * layer runs at all, so the protocol details get tested rather than assumed.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createHttpAiBinding, endpointFor, HTTP_TIMEOUT_MS } from "./http-binding";
import { AiTextResponse, resolveAiBinding, resolveGateway } from "./ai";

const CONFIG = {
  accountId: "acct-1",
  apiToken: "tok-1",
  gatewayId: null,
  baseUrl: undefined,
} as const;

const INPUT = {
  messages: [{ role: "system" as const, content: "s" }],
  temperature: 0.1,
  max_tokens: 320,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** fetchJson normalises headers into a Headers instance before sending. */
function headerOf(init: RequestInit | undefined, name: string): string | null {
  const raw = init?.headers;
  if (raw instanceof Headers) return raw.get(name);
  if (raw && typeof raw === "object") {
    const found = Object.entries(raw as Record<string, string>).find(
      ([k]) => k.toLowerCase() === name,
    );
    return found?.[1] ?? null;
  }
  return null;
}

function stubFetch(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, requestInit?: unknown) => {
    calls.push({ url: String(url), init: (requestInit ?? {}) as RequestInit });
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  }) as typeof fetch;
  return calls;
}

describe("where the call goes", () => {
  it("uses the direct API when no gateway is configured", () => {
    expect(endpointFor(CONFIG, "@cf/meta/llama-3.1-8b-instruct")).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/meta/llama-3.1-8b-instruct",
    );
  });

  it("routes through AI Gateway when one is configured", () => {
    expect(
      endpointFor({ ...CONFIG, gatewayId: "sidenote" }, "@cf/meta/llama-3.1-8b-instruct"),
    ).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct-1/sidenote/workers-ai/@cf/meta/llama-3.1-8b-instruct",
    );
  });

  it("can be pointed at a local stub, which is how this is proved end to end", () => {
    expect(endpointFor({ ...CONFIG, baseUrl: "http://localhost:8787/" }, "m")).toBe(
      "http://localhost:8787/m",
    );
  });
});

describe("speaking the REST protocol", () => {
  it("unwraps `result`, so callers see the same shape the native binding gives", async () => {
    stubFetch({ success: true, result: { response: "hello" }, errors: [] });
    const binding = createHttpAiBinding(CONFIG);
    expect(await binding.run("m", INPUT)).toEqual({ response: "hello" });
  });

  it("sends the token and the generation parameters", async () => {
    const calls = stubFetch({ success: true, result: { response: "x" }, errors: [] });
    await createHttpAiBinding(CONFIG).run("m", INPUT);
    expect(headerOf(calls[0]?.init, "authorization")).toBe("Bearer tok-1");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body["temperature"]).toBe(0.1);
    expect(body["max_tokens"]).toBe(320);
  });

  it("captures the gateway log id from the response header", async () => {
    // The native binding exposes this as a property; over HTTP it arrives as
    // a header. Non-negotiable #9 needs it either way.
    stubFetch(
      { success: true, result: { response: "x" }, errors: [] },
      { headers: { "cf-aig-log-id": "01JCX8Q0ZK4M7ND2VYB3TWERAF" } },
    );
    const binding = createHttpAiBinding(CONFIG);
    await binding.run("m", INPUT);
    expect(binding.aiGatewayLogId).toBe("01JCX8Q0ZK4M7ND2VYB3TWERAF");
  });

  it("forwards gateway cache options as headers", async () => {
    const calls = stubFetch({ success: true, result: { response: "x" }, errors: [] });
    await createHttpAiBinding(CONFIG).run("m", INPUT, {
      gateway: { id: "sidenote", cacheTtl: 3600, skipCache: true },
    });
    expect(headerOf(calls[0]?.init, "cf-aig-cache-ttl")).toBe("3600");
    expect(headerOf(calls[0]?.init, "cf-aig-skip-cache")).toBe("true");
  });

  it("clears the stale log id before each call", async () => {
    stubFetch(
      { success: true, result: { response: "x" }, errors: [] },
      { headers: { "cf-aig-log-id": "first" } },
    );
    const binding = createHttpAiBinding(CONFIG);
    await binding.run("m", INPUT);
    expect(binding.aiGatewayLogId).toBe("first");

    // A later call with no header must not keep reporting the earlier id —
    // that would attribute a reading to an inference that did not produce it.
    stubFetch({ success: true, result: { response: "x" }, errors: [] });
    await binding.run("m", INPUT);
    expect(binding.aiGatewayLogId).toBeNull();
  });
});

describe("failures become failures, not empty readings", () => {
  it("throws on a 200 that says success:false", async () => {
    // Cloudflare returns 200 with success:false for some errors. Treating
    // that as a result would put an empty reading in front of a reviewer.
    stubFetch({
      success: false,
      result: null,
      errors: [{ code: 7000, message: "No route for that URI" }],
    });
    await expect(createHttpAiBinding(CONFIG).run("m", INPUT)).rejects.toThrow(
      /No route for that URI/,
    );
  });

  it("throws on an HTTP error status", async () => {
    stubFetch({ success: false, result: null, errors: [] }, { status: 401 });
    await expect(createHttpAiBinding(CONFIG).run("m", INPUT)).rejects.toThrow(/http/);
  });

  it("throws on a body that is not the expected shape", async () => {
    stubFetch({ unexpected: true });
    await expect(createHttpAiBinding(CONFIG).run("m", INPUT)).rejects.toThrow(
      /schema-mismatch/,
    );
  });

  it("has a timeout, so a hung model cannot hold a request open", () => {
    expect(HTTP_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("choosing a model", () => {
  it("prefers the native Workers binding when one is present", () => {
    const native = { run: () => Promise.resolve({}) };
    const ai = resolveAiBinding({ AI: native, CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" });
    expect(ai.source).toBe("workers-binding");
    expect(ai.binding).toBe(native);
  });

  it("falls back to HTTP when credentials are present but no binding is", () => {
    const ai = resolveAiBinding({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" });
    expect(ai.source).toBe("http");
    expect(ai.binding).not.toBeNull();
    expect(ai.reason).toBeNull();
  });

  it("returns null with a reason naming the missing half", () => {
    expect(resolveAiBinding({ CLOUDFLARE_ACCOUNT_ID: "a" }).reason).toContain(
      "CLOUDFLARE_API_TOKEN is not set",
    );
    expect(resolveAiBinding({ CLOUDFLARE_API_TOKEN: "t" }).reason).toContain(
      "CLOUDFLARE_ACCOUNT_ID is not set",
    );
    expect(resolveAiBinding({}).reason).toContain("CLOUDFLARE_ACCOUNT_ID and");
  });

  it("lets the off switch win over configured credentials", () => {
    // Step 8's degraded walk depends on this: disabling generation must not
    // require unsetting the credentials.
    const ai = resolveAiBinding({
      SIDENOTE_AI_DISABLED: "1",
      AI: { run: () => Promise.resolve({}) },
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_API_TOKEN: "t",
    });
    expect(ai.binding).toBeNull();
    expect(ai.source).toBe("none");
  });

  it("ignores a string called AI, which is what process.env would hand it", () => {
    // process.env values are all strings; only a real binding has .run().
    const ai = resolveAiBinding({ AI: "not-a-binding" });
    expect(ai.binding).toBeNull();
  });

  it("reads the gateway id from the same environment", () => {
    expect(resolveGateway({ SIDENOTE_AI_GATEWAY_ID: "sidenote" })?.id).toBe("sidenote");
  });
});


describe("both reply shapes Workers AI returns", () => {
  /*
    THE REGRESSION THIS GUARDS. The schema accepted only `{ response }` — the
    shape the stub emitted — while Workers AI answers
    @cf/meta/llama-3.1-8b-instruct in the OpenAI-compatible shape. Every test
    passed; every real inference came back "the runtime returned no text
    response" and every reading degraded to `unavailable`. The system reported
    the failure honestly and the failure was its own.

    Found only by fetching a real FDA label and watching a real call fail,
    because the fake had been agreeing with the schema the whole time.
  */
  it("reads the OpenAI-compatible shape the REST API returns", () => {
    const parsed = AiTextResponse.safeParse({
      choices: [{ message: { content: '{"found":false}' } }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.response).toBe('{"found":false}');
  });

  it("still reads the legacy shape the native binding returns", () => {
    // Kept, not replaced: env.AI and some models still answer this way, and
    // reading only the most recently observed shape is how this happened.
    const parsed = AiTextResponse.safeParse({ response: "hello" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.response).toBe("hello");
  });

  it("rejects a reply carrying neither", () => {
    expect(AiTextResponse.safeParse({ choices: [] }).success).toBe(false);
    expect(AiTextResponse.safeParse({ text: "nope" }).success).toBe(false);
  });
});

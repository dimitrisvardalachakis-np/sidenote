import "server-only";
import { headers } from "next/headers";
import { isWorkersRuntime } from "@/lib/platform/runtime";

/**
 * Best available identifier for the caller, used as the rate-limit key.
 *
 * ON WORKERS, ONE HEADER AND NO FALLBACK.
 *
 * `CF-Connecting-IP` is written by the edge and cannot be forged by a client:
 * Cloudflare overwrites whatever the request arrived with. `X-Forwarded-For`
 * is the opposite — it is whatever the caller typed. Reading it meant the
 * rate-limit bucket key was chosen by the person being rate-limited, so a
 * script that incremented a counter in that header got a fresh allowance on
 * every request and the limiter counted to one, forever, in a million
 * different buckets.
 *
 * That fallback existed for local development, where there is no proxy at all
 * and no CF-Connecting-IP either. It is kept for exactly that, and refused
 * where it is dangerous: on Workers, a missing CF-Connecting-IP is not an
 * invitation to believe the client, it is a single shared bucket. Sharing one
 * bucket throttles innocent callers together, which is a bad day; honouring a
 * forged header removes the limit entirely, which is not a limit.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();

  const cloudflare = h.get("cf-connecting-ip");
  if (cloudflare !== null && cloudflare !== "") return cloudflare;

  if (isWorkersRuntime()) {
    /*
      Deployed, and the one trustworthy header is absent. Rather than fall
      through to a forgeable one, everything in this state shares a bucket —
      conservative, and visible: a sudden collapse of distinct keys is
      something an operator can see, where a silently disabled limiter is not.
    */
    return "unattributable";
  }

  // Local development only, and a convenience rather than an identity: there
  // is no proxy here, so nothing is asserting this and nothing needs to.
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") return first;

  return h.get("x-real-ip") ?? "unknown";
}

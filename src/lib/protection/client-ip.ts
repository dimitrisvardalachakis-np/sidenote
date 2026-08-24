import "server-only";
import { headers } from "next/headers";

/**
 * Best available identifier for the caller, used as the rate-limit key.
 *
 * x-forwarded-for is trivially spoofable unless a trusted proxy sets it, and
 * behind Cloudflare the honest source is CF-Connecting-IP, which the edge
 * writes and a client cannot forge. Locally there is no proxy at all, so this
 * is a convenience, not an identity, and the rate limit built on it is a
 * speed bump rather than a wall. Saying so here so nobody reads the call site
 * and assumes otherwise.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const cloudflare = h.get("cf-connecting-ip");
  if (cloudflare !== null && cloudflare !== "") return cloudflare;

  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") return first;

  return h.get("x-real-ip") ?? "unknown";
}

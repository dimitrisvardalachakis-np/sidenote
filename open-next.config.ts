import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * The OpenNext build for Cloudflare Workers.
 *
 * `next build` produces a Node server. Workers is not Node, so something has
 * to translate one into the other; this adapter is that something, and this
 * file is where its choices are made explicit rather than defaulted into.
 *
 * NOTHING IS OVERRIDDEN HERE YET, AND THAT IS DELIBERATE.
 *
 * The adapter can put Next's incremental cache in KV or R2, its tag cache in
 * D1, and its revalidation queue in a Durable Object. Every one of those is a
 * binding CLAUDE.md assigns to Cluster D, and wiring them here would mean
 * Cluster C quietly creating the storage layer the next cluster is supposed to
 * build deliberately. So the defaults stand: the cache falls back to static
 * assets, which is correct for an app whose dynamic routes are all
 * `force-dynamic` anyway.
 *
 * When Cluster D lands, this is the file that grows an `incrementalCache` and
 * a `tagCache`.
 */
export default defineCloudflareConfig();

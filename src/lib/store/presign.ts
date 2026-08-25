import "server-only";
import { AwsClient } from "aws4fetch";
import { getCloudflareEnv, readSetting } from "@/lib/platform/env";

/**
 * Presigned R2 uploads — the browser PUTs the bytes, the Worker never sees
 * them.
 *
 * CLAUDE.md, pipeline step 3: "Original file → R2 via a presigned URL, direct
 * from the browser. The Worker only ever stores the object key."
 *
 * WHY THIS IS WORTH THE CREDENTIALS IT COSTS.
 *
 * Until now every uploaded document has travelled through a Server Action,
 * which is why next.config.ts raises the action body limit to 12MB and says in
 * its comment that the line should be DELETED rather than raised again. That
 * limit is not a preference: a Worker has a request body ceiling and a memory
 * ceiling, and a 40-page CCDS is a normal document in this domain. Routing
 * bytes through the application means the largest file anyone can upload is
 * decided by how much of a Worker's memory we are willing to spend on it.
 *
 * A presigned URL removes the application from the path entirely. R2 checks
 * the signature, the bytes go straight from the reviewer's browser to the
 * bucket, and the Server Action that follows carries only metadata and the
 * extracted text.
 *
 * WHY IT NEEDS SEPARATE CREDENTIALS FROM THE BINDING.
 *
 * `env.DOCUMENTS` is a binding — it works inside the Worker and cannot be
 * handed to a browser. Presigning is AWS SigV4 against R2's S3-compatible API,
 * which needs an Access Key ID and Secret from the R2 dashboard. Those are the
 * one piece of Cluster D configuration that is not a `wrangler ... create`
 * command, and forgetting them is the most likely reason this returns null.
 *
 * When it does return null the upload falls back to the Server Action path,
 * which still works. Slower, capped, and honest about it.
 */

declare global {
  interface CloudflareEnv {
    /** R2 S3-API Access Key ID, from the R2 dashboard. Not the binding. */
    R2_S3_ACCESS_KEY_ID?: string;
    /** Its secret. `wrangler secret put R2_S3_SECRET_ACCESS_KEY`. */
    R2_S3_SECRET_ACCESS_KEY?: string;
    /** The Cloudflare account id that owns the bucket. */
    R2_S3_ACCOUNT_ID?: string;
    /** Bucket name. Matches `bucket_name` in wrangler.jsonc. */
    R2_S3_BUCKET?: string;
  }
}

export interface PresignedUpload {
  readonly url: string;
  readonly key: string;
  /** Seconds. The browser must start the PUT within this window. */
  readonly expiresInSeconds: number;
  /** Echoed so the client sends exactly what was signed. */
  readonly contentType: string;
}

/**
 * Long enough to choose a file and upload it on a hotel connection, short
 * enough that a URL leaking out of a browser history is not an open door to
 * the bucket.
 */
const EXPIRY_SECONDS = 15 * 60;

interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly accountId: string;
  readonly bucket: string;
}

async function credentials(): Promise<S3Credentials | null> {
  const env = await getCloudflareEnv();

  const accessKeyId = readSetting(env, "R2_S3_ACCESS_KEY_ID");
  const secretAccessKey = readSetting(env, "R2_S3_SECRET_ACCESS_KEY");
  const accountId = readSetting(env, "R2_S3_ACCOUNT_ID");
  const bucket = readSetting(env, "R2_S3_BUCKET");

  // All four or none. A partial set is a misconfiguration, and signing with
  // three of the four produces a URL that fails at PUT time in the browser —
  // where the error is somebody else's CORS message, not ours.
  if (
    accessKeyId === null ||
    secretAccessKey === null ||
    accountId === null ||
    bucket === null
  ) {
    return null;
  }
  return { accessKeyId, secretAccessKey, accountId, bucket };
}

/** True when the browser-direct path is available. Drives the UI. */
export async function presignedUploadsAvailable(): Promise<boolean> {
  return (await credentials()) !== null;
}

/**
 * A URL the browser may PUT one object to.
 *
 * `key` is NOT taken from the client. It is built server-side by
 * `objectKeyFor()` from the source type and a fresh document id, so a reviewer
 * cannot presign a write over `company/<someone-elses-document>.pdf` — which,
 * given that the prefix IS the confidentiality namespace, would be the whole
 * ballgame.
 */
export async function presignUpload(
  key: string,
  contentType: string,
): Promise<PresignedUpload | null> {
  const creds = await credentials();
  if (creds === null) return null;

  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  const endpoint = new URL(
    `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/${key}`,
  );
  endpoint.searchParams.set("X-Amz-Expires", String(EXPIRY_SECONDS));

  const signed = await client.sign(
    new Request(endpoint, { method: "PUT" }),
    {
      aws: {
        signQuery: true,
        // Signing the content type binds the URL to the kind of object it may
        // create. Without it the same URL uploads a PDF or an HTML page, and
        // an HTML page served back from a bucket is a stored-XSS delivery
        // mechanism wearing our domain name.
        allHeaders: true,
      },
      headers: { "content-type": contentType },
    },
  );

  return {
    url: signed.url,
    key,
    expiresInSeconds: EXPIRY_SECONDS,
    contentType,
  };
}

/**
 * SHA-256 of a string, for the two places that need content identity.
 *
 * WebCrypto rather than a hand-rolled hash: it is on Workers and in Node, it is
 * not going to collide, and a cheap 32-bit hash that collides once in a corpus
 * of a hundred thousand chunks would silently give two different passages the
 * same embedding.
 *
 * Lifted out of `lib/pipeline/steps.ts`, where it was private to the dedupe
 * step, when the upload path needed the same function for a different question.
 * The two questions rhyme and should keep the same answer: the pipeline asks
 * "have I embedded this paragraph already", the library asks "do I already hold
 * this document". A second implementation of "the same text" is a second thing
 * to get wrong, and the failure would be invisible — a duplicate that the
 * pipeline dedupes and the library does not.
 */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

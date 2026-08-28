/**
 * A stand-in for Workers AI that speaks the real REST protocol.
 *
 * Not a mock inside the test process — an actual HTTP server the real
 * `HttpAiBinding` connects to over a socket. That is the difference between
 * proving the interface and proving the transport: URL construction, headers,
 * the `result` envelope, the `cf-aig-log-id` header, JSON parsing and the
 * timeout are all exercised for real. The only thing it does not prove is
 * Cloudflare's own uptime and the quality of a genuine 8B model.
 *
 * It answers faithfully: it reads the passages out of the prompt it was given
 * and quotes the first sentence of the most relevant one, verbatim. That is
 * what a well-behaved model does, and it means the verbatim gate downstream
 * is genuinely being satisfied rather than bypassed.
 *
 *   node scripts/stub-model.mjs [port]
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8787);

/** Pull the fenced passages back out of the user message. */
function passages(text) {
  const out = [];
  const re = /<<<PASSAGE id="([^"]+)"(?:[^\n]*)\n([\s\S]*?)\nPASSAGE>>>/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ id: m[1], text: m[2] });
  return out;
}

/** Overlap between the question and a passage, on content words. */
function score(question, passage) {
  const words = new Set(
    question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  );
  const lower = passage.toLowerCase();
  let hits = 0;
  for (const w of words) if (lower.includes(w)) hits += 1;
  return hits;
}

function reply(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const system = messages.find((m) => m.role === "system")?.content ?? "";

  // The extraction prompt asks for a different shape than the assessment one.
  if (system.includes("extract structured fields")) {
    const report = /<<<REPORT\n([\s\S]*?)\nREPORT>>>/.exec(user)?.[1] ?? "";
    const seriousness = [];
    for (const [criterion, phrase] of [
      ["hospitalisation", /(was kept in overnight|admitted to [a-z ]+|kept in overnight)/i],
      ["death", /(died[^.]*)/i],
      ["life_threatening", /(difficulty breathing|life was in danger)/i],
    ]) {
      const found = phrase.exec(report);
      // Copied out of the report character for character, which is the only
      // way it survives verification.
      if (found) seriousness.push({ criterion, phrase: found[1] });
    }
    return JSON.stringify({
      suspectDrug: /\b(Hepalex|Covaxil|Cardiquel|Dermacil|Pulmoxa|NRV-114)\b/i.exec(report)?.[1] ?? null,
      reaction: null,
      dose: /(\w+ tablets? a day|\d+\s?mg[^.,]*)/i.exec(report)?.[1] ?? null,
      route: /by mouth|orally|tablet/i.test(report) ? "oral" : null,
      patientAgeYears: Number(/\b(?:is|aged?)\s+(\d{1,3})\b/i.exec(report)?.[1] ?? "") || null,
      patientSex: /\b(she|her|mother|woman|female)\b/i.test(report) ? "female"
        : /\b(he|his|father|man|male)\b/i.test(report) ? "male" : null,
      therapyStart: /\b(\d{4}-\d{2}-\d{2})\b/.exec(report)?.[1] ?? null,
      therapyEnd: null,
      reactionOnset: null,
      outcome: /getting better|recovering/i.test(report) ? "recovering" : null,
      seriousness,
    });
  }

  const found = passages(user);
  if (found.length === 0) {
    return JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null });
  }

  const question = /^REACTION: (.*)$/m.exec(user)?.[1] ?? "";
  const ranked = [...found].sort((a, b) => score(question, b.text) - score(question, a.text));
  const best = ranked[0];

  if (score(question, best.text) === 0) {
    return JSON.stringify({ found: false, chunkId: null, quotedSpan: null, rationale: null });
  }

  /*
    Pick the sentence that actually mentions what was asked, and copy it
    exactly. Splitting on ". " rather than "." so a section number like "6.1"
    or a figure like "2.1%" does not end a sentence — the same trap
    isSingleSentence has downstream.
  */
  const sentences = best.text.split(/(?<=\.)\s+(?=[A-Z])/).filter((x) => x.trim().length > 0);
  const span =
    sentences.find((sentence) => score(question, sentence) > 0)?.trim() ??
    sentences[0]?.trim() ??
    best.text.slice(0, 160);
  return JSON.stringify({
    found: true,
    chunkId: best.id,
    quotedSpan: span,
    rationale: "The passage describes the reaction asked about.",
  });
}

/**
 * A deterministic stand-in for bge-base-en-v1.5.
 *
 * BE CLEAR ABOUT WHAT THIS IS: lexical matching in disguise. Each content word
 * is hashed into one of 768 buckets and the vector is L2-normalised, so texts
 * sharing words score high cosine and texts sharing none score near zero. That
 * is enough to prove the whole chain — embed, upsert, query, hydrate, fuse,
 * prompt — end to end with no Cloudflare account, and enough for a test to
 * assert a ranking.
 *
 * It is NOT enough to demonstrate the thing the dense half exists for. "pins
 * and needles" and "paraesthesia" share no words, so this returns near-zero
 * cosine for them where real bge returns a strong match. Only the real model
 * shows semantic recall. This proves the plumbing; it cannot prove the meaning.
 */
const EMBED_DIMENSIONS = 768;

function embed(text) {
  const values = new Array(EMBED_DIMENSIONS).fill(0);
  const words = String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  for (const word of words) {
    // FNV-1a, so the same word always lands in the same bucket across runs
    // and across processes — a random projection would make every restart a
    // different index.
    let hash = 0x811c9dc5;
    for (let i = 0; i < word.length; i += 1) {
      hash ^= word.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    values[hash % EMBED_DIMENSIONS] += 1;
  }

  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  // An all-stopword input has no direction. Return the zero vector rather than
  // dividing by zero; cosine against it is 0, which is the honest answer.
  return norm === 0 ? values : values.map((v) => v / norm);
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (!(req.headers.authorization ?? "").startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, result: null, errors: [{ message: "missing token" }] }));
      return;
    }

    let result;
    try {
      const parsed = JSON.parse(body);
      // The embedding models take `text`; the instruct models take `messages`.
      // Dispatching on the body rather than the URL means this works whether
      // the caller went direct or through a gateway path.
      if (parsed.text !== undefined) {
        const texts = Array.isArray(parsed.text) ? parsed.text : [parsed.text];
        const data = texts.map(embed);
        result = { shape: [data.length, EMBED_DIMENSIONS], data };
      } else {
        /*
          The OpenAI-compatible shape, because that is what Workers AI really
          returns for @cf/meta/llama-3.1-8b-instruct:

            { result: { choices: [ { message: { content } } ] } }

          This stub used to emit the older { response } shape, and the schema
          in ai.ts accepted only that — so every test, every eval and every
          local run passed while the code could not read one word from the
          actual service. A stub easier to satisfy than the thing it stands in
          for hides precisely the bug it exists to catch.
        */
        result = {
          choices: [{ message: { content: reply(parsed.messages ?? []) } }],
        };
      }
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, result: null, errors: [{ message: "bad request" }] }));
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json",
      // AI Gateway returns this; the binding reads it for the audit line.
      "cf-aig-log-id": `stub-${Date.now().toString(36)}`,
    });
    res.end(JSON.stringify({ success: true, result, errors: [] }));
  });
}).listen(port, () => {
  process.stdout.write(`stub model listening on http://localhost:${port}\n`);
});

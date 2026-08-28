/**
 * Conversational intake for a public side-effect report.
 *
 * WHAT THIS IS, PLAINLY
 * There is no language model wired into this project — no API key, no Workers
 * AI in this session. So the dialogue below is a deterministic slot-filling
 * state machine, not a model. It is written that way on purpose rather than
 * faked: the questions it asks are derived from the four minimum validity
 * criteria in CLAUDE.md, which is exactly what a model would have to be
 * prompted to collect anyway.
 *
 * The RETRIEVAL half is real. When the reporter has said enough, this searches
 * the chunks actually ingested through the library and returns actual
 * citations — chunk ids and quoted spans from real uploaded documents. So the
 * "is this already known?" answer is genuinely grounded, and non-negotiable #3
 * holds: no claim is shown without the passage behind it.
 *
 * Where a model goes: replace `interpret()` with an extraction call and
 * `composeVerdict()` with a grounded generation call. The state machine, the
 * retrieval, the citations and the submission path all stay as they are —
 * which is the point of keeping this pure and testable.
 *
 * Non-negotiable #4 still governs the outcome: this never decides anything.
 * Every completed conversation is submitted for review regardless of what
 * retrieval found. The only difference a "known" verdict makes is what the
 * reporter is told while they wait.
 */
import type {
  Citation,
  DocumentChunk,
  DocumentId,
  SeriousnessCriterion,
} from "@/lib/schemas";
import { SERIOUSNESS_CRITERIA } from "@/lib/schemas";
import { lexicalSearch, toCitation } from "@/lib/retrieval/search";
import { MATCHED_ANY_TERM } from "@/lib/retrieval/thresholds";
import type { Extraction, SeriousnessEvidence } from "@/lib/extract/schema";

export type IntakeSlot =
  | "narrative"
  | "drug"
  | "reaction"
  | "age"
  | "sex"
  | "seriousness"
  | "reporterName"
  | "reporterContact";

export interface IntakeSlots {
  readonly narrative: string | null;
  readonly drug: string | null;
  readonly reaction: string | null;
  readonly age: number | null;
  readonly sex: "male" | "female" | "unknown" | null;
  readonly seriousness: readonly SeriousnessCriterion[] | null;
  readonly reporterName: string | null;
  readonly reporterContact: string | null;
  /**
   * Fields only a model reads, and the phrases behind any seriousness it
   * raised. Empty on the fallback path, which is why every one of these is
   * nullable and nothing downstream may require them.
   */
  readonly dose: string | null;
  readonly route: string | null;
  readonly outcome: string | null;
  readonly therapyStart: string | null;
  readonly therapyEnd: string | null;
  readonly reactionOnset: string | null;
  /**
   * The exact words in the narrative that carried each seriousness criterion.
   * This is what a regex cannot produce, and what turns a `declared` flag into
   * a `narrative` one with a span a reviewer can see highlighted.
   */
  readonly seriousnessEvidence: readonly SeriousnessEvidence[];
}

export const EMPTY_SLOTS: IntakeSlots = {
  narrative: null,
  drug: null,
  reaction: null,
  age: null,
  sex: null,
  seriousness: null,
  reporterName: null,
  reporterContact: null,
  dose: null,
  route: null,
  outcome: null,
  therapyStart: null,
  therapyEnd: null,
  reactionOnset: null,
  seriousnessEvidence: [],
};

export interface IntakeMessage {
  readonly role: "assistant" | "reporter";
  readonly text: string;
  /** Passages behind this message. Empty unless the message makes a claim. */
  readonly citations: readonly Citation[];
}

export interface IntakeVerdict {
  /** True when retrieval found the reaction described in a safety document. */
  readonly alreadyDescribed: boolean;
  /**
   * False when there was no document to search at all.
   *
   * THE THIRD STATE, and it exists because its absence told a real reporter
   * something untrue. They reported dizziness after a Moderna COVID vaccine.
   * openFDA's drug label dataset holds no vaccines — only OTC drugs,
   * prescription drugs and cellular therapies — so nothing was fetched and
   * nothing was in scope. The chat replied: "I could not find dizziness in the
   * published information for moderna coronovirus injection."
   *
   * That is an assertion about a document nobody opened. The two-state boolean
   * could not tell "searched the label and it is not there" from "there was no
   * label to search", so it said the first while the second was true. It is
   * the same collapse `source_unavailable` exists to prevent on the reviewer
   * side, and it leaned the safe way — over-encouraging a report — which is
   * exactly why it survived so long unnoticed.
   */
  readonly consulted: boolean;
  readonly companyCitations: readonly Citation[];
  readonly publicCitations: readonly Citation[];
}

export interface IntakeState {
  readonly messages: readonly IntakeMessage[];
  readonly slots: IntakeSlots;
  /** The slot the last assistant question was asking about. */
  readonly pending: IntakeSlot | null;
  readonly phase: "collecting" | "complete";
  readonly verdict: IntakeVerdict | null;
}

const OPENING =
  "Tell me what happened, in your own words. Who is it about, what went wrong, and which medicine were they taking? You can write it however you like.";

export function startConversation(): IntakeState {
  return {
    messages: [{ role: "assistant", text: OPENING, citations: [] }],
    slots: EMPTY_SLOTS,
    pending: "narrative",
    phase: "collecting",
    verdict: null,
  };
}

// ---------------------------------------------------------------------------
// Interpretation — the part a model would replace
// ---------------------------------------------------------------------------

const SEX_PATTERNS: readonly (readonly [RegExp, "male" | "female"])[] = [
  [/\b(male|man|men|boy|he|him|his|husband|father|son|brother)\b/i, "male"],
  [/\b(female|woman|women|girl|she|her|wife|mother|daughter|sister)\b/i, "female"],
];

/**
 * Ages written the way people actually write them.
 *
 * Note `years?` — the first draft omitted the plural and silently failed on
 * "45 years old", which is how most people write it. Caught by the tests.
 */
const AGE_PATTERNS: readonly RegExp[] = [
  /\b(\d{1,3})\s*[-\s]?\s*years?[\s-]*old\b/i,
  /\baged?\s+(\d{1,3})\b/i,
  /\b(\d{1,3})\s*(?:yo|y\/o|yrs?)\b/i,
];

export function extractAge(text: string): number | null {
  for (const pattern of AGE_PATTERNS) {
    const match = pattern.exec(text);
    const raw = match?.[1];
    if (raw !== undefined) {
      const age = Number(raw);
      if (Number.isFinite(age) && age >= 0 && age <= 130) return age;
    }
  }
  // A bare number, but only when the whole reply is that number — otherwise
  // "20mg twice a day" becomes a 20-year-old.
  const bare = /^\s*(\d{1,3})\s*$/.exec(text);
  const raw = bare?.[1];
  if (raw !== undefined) {
    const age = Number(raw);
    if (age >= 0 && age <= 130) return age;
  }
  return null;
}

export function extractSex(text: string): "male" | "female" | "unknown" | null {
  if (/\b(don'?t know|not sure|unknown|prefer not)\b/i.test(text)) return "unknown";
  for (const [pattern, value] of SEX_PATTERNS) {
    if (pattern.test(text)) return value;
  }
  return null;
}

/**
 * Parse a reply to a direct "how old are they?" question.
 *
 * Deliberately more permissive than extractAge. Opportunistic extraction from
 * free prose has to be cautious — "20mg twice a day" must not become a
 * 20-year-old. But when the question just asked was about age, any plain
 * number in the reply is the answer, and "she is 34" is a perfectly normal way
 * to give it. Context changes what is safe to assume, so the two cases get two
 * functions rather than one compromise.
 */
export function parseAgeAnswer(text: string): number | null {
  const direct = extractAge(text);
  if (direct !== null) return direct;
  const any = /\b(\d{1,3})\b/.exec(text);
  const raw = any?.[1];
  if (raw === undefined) return null;
  const age = Number(raw);
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * Find a medicine the reporter named, by matching against the substances and
 * brands already in the library.
 *
 * Matching against known products rather than guessing at any capitalised word
 * is what keeps this from "extracting" the reporter's surname as a drug. The
 * cost is that an unknown product is not recognised — so the flow asks, rather
 * than inventing.
 */
export function extractDrug(
  text: string,
  knownProducts: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  const hits = knownProducts
    .filter((product) => product.length > 2 && lower.includes(product.toLowerCase()))
    // Longest match wins: "Hepalex XR" beats "Hepalex".
    .sort((a, b) => b.length - a.length);
  return hits[0] ?? null;
}

const SERIOUSNESS_KEYWORDS: Readonly<Record<SeriousnessCriterion, RegExp>> = {
  death: /\b(died|death|passed away|fatal)\b/i,
  life_threatening: /\b(life[\s-]?threatening|nearly died|life was in danger|intensive care|resuscitat)\w*/i,
  hospitalisation: /\b(hospital|admitted|a&e|emergency room|\ber\b|inpatient|overnight)\b/i,
  persistent_disability: /\b(disabilit|disabled|permanent|lasting damage|never recovered)\w*/i,
  congenital_anomaly: /\b(birth defect|congenital|born with)\b/i,
  other_medically_important: /\b(serious|severe|urgent)\b/i,
};

export function extractSeriousness(
  text: string,
): readonly SeriousnessCriterion[] {
  if (/\b(no|none|nothing|neither)\b/i.test(text.trim()) && text.trim().length < 24) {
    return [];
  }
  return SERIOUSNESS_CRITERIA.filter((criterion) =>
    SERIOUSNESS_KEYWORDS[criterion].test(text),
  );
}

/**
 * Everything we can pull from one free-text message.
 *
 * The deterministic half is unchanged and is the floor: whatever the model
 * does or does not manage, these three still run. `extraction` is layered on
 * top when a model produced a verified one, and is simply absent otherwise —
 * which is the whole of the fallback. There is no third code path to keep in
 * step, and no partially-merged record that neither path is responsible for.
 *
 * The model wins where both have an opinion. It has read the whole sentence;
 * the regexes have matched a token. Where the model returned null the regex
 * value stands, so a model that fills nothing costs nothing.
 */
function interpret(
  text: string,
  slots: IntakeSlots,
  knownProducts: readonly string[],
  extraction: Extraction | null,
): IntakeSlots {
  const withPatterns: IntakeSlots = {
    ...slots,
    drug: slots.drug ?? extractDrug(text, knownProducts),
    age: slots.age ?? extractAge(text),
    sex: slots.sex ?? extractSex(text),
  };

  if (extraction === null) return withPatterns;

  /*
    THE REPORTER'S OWN WORDS WIN. Every time, on every field.

    `drug`, `age` and `sex` used to read `extraction.x ?? withPatterns.x` — the
    model first, the person second — while `reaction` alone read the other way
    round. That inversion filed a real report against the wrong medicine.

    A reporter wrote "after i had my coronovirus injection i feel dizzy" and
    later typed "moderna coronovirus injection" when asked which medicine. The
    model, whose prompt lists the products this library holds, answered
    `suspectDrug: "Covaxil"` — the nearest-sounding demo product, and not a
    medicine the reporter had ever mentioned. Because the model went first,
    that is what the case was filed under: a Moderna vaccine report recorded
    against an unrelated drug, corrupting the safety signal for both.

    This is non-negotiable #4 at its plainest. The model may fill a gap the
    reporter left; it may never overwrite an answer the reporter gave. `??`
    with the person on the left says exactly that, and it is the same shape
    `reaction` always had.
  */
  return {
    ...withPatterns,
    drug: withPatterns.drug ?? extraction.suspectDrug,
    reaction: withPatterns.reaction ?? extraction.reaction,
    age: withPatterns.age ?? extraction.patientAgeYears,
    sex: withPatterns.sex ?? extraction.patientSex,
    dose: extraction.dose ?? withPatterns.dose,
    route: extraction.route ?? withPatterns.route,
    outcome: extraction.outcome ?? withPatterns.outcome,
    therapyStart: extraction.therapyStart ?? withPatterns.therapyStart,
    therapyEnd: extraction.therapyEnd ?? withPatterns.therapyEnd,
    reactionOnset: extraction.reactionOnset ?? withPatterns.reactionOnset,
    // Only ever added to, never used to clear a criterion the reporter
    // answered directly. A model that reads no hospitalisation into a
    // narrative has not contradicted a reporter who ticked the box.
    seriousnessEvidence:
      extraction.seriousness.length > 0
        ? extraction.seriousness
        : withPatterns.seriousnessEvidence,
  };
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

/** Asked in this order. Drug and reaction first: without them there is no case. */
const ORDER: readonly IntakeSlot[] = [
  "drug",
  "reaction",
  "age",
  "sex",
  "seriousness",
  "reporterName",
  "reporterContact",
];

const QUESTIONS: Readonly<Record<IntakeSlot, string>> = {
  narrative: OPENING,
  drug:
    "Which medicine were they taking? The name on the box is enough — I could not pick one out of what you wrote.",
  reaction:
    "In a few words, what would you call what went wrong? For example “a rash on both hands”.",
  age: "How old is the person this happened to? An approximate age is fine.",
  sex: "Are they male or female? Say “prefer not to say” if you would rather not.",
  seriousness:
    "Did any of these happen? They went into hospital, their life was in danger, they were left with a lasting disability, a baby was born with a problem, or they died. Say “none of those” if none did.",
  reporterName: "What is your name?",
  reporterContact:
    "And an email address or phone number, in case a reviewer needs to ask you one more thing.",
};

function nextMissing(slots: IntakeSlots): IntakeSlot | null {
  for (const slot of ORDER) {
    if (slot === "seriousness") {
      if (slots.seriousness === null) return slot;
      continue;
    }
    if (slots[slot] === null) return slot;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * Who is going to read the answer.
 *
 * This is not a preference, it is a confidentiality boundary. The public
 * intake chat has no login by design — anyone can open it. The company
 * library holds CCDS and Investigator's Brochure text, which CLAUDE.md is
 * explicit are confidential. Quoting a CCDS passage back to an anonymous
 * member of the public would be a disclosure incident dressed up as a helpful
 * answer, and it is exactly the mistake a naive "search everything and show
 * what you find" implementation makes.
 *
 * So the audience is a required argument rather than an option with a default.
 * Every call site has to say who is asking.
 */
export type Audience = "public" | "reviewer";

/**
 * Search the ingested documents for the reported reaction.
 *
 * Company and public namespaces are searched separately and never merged: a
 * citation must state which it came from, and the two answer different
 * questions — listedness and expectedness.
 */
export function assessAgainstDocuments(
  slots: IntakeSlots,
  corpus: readonly DocumentChunk[],
  audience: Audience,
  /**
   * Documents held for the medicine the reporter named. Retrieval never leaves
   * this set; an empty set means nothing is quoted.
   */
  scope: ReadonlySet<DocumentId> | null = null,
): IntakeVerdict {
  /*
    The query is the reaction, and the corpus is scoped to the product.

    Both halves used to be wrong together and the effect was worse than either.
    The drug name went into the query as a term, so a chunk matching only the
    medicine's own name scored a hit; and the corpus was every document in the
    library, so that hit could come from a different product entirely. A
    reporter describing a novel reaction to Covaxil could therefore be told
    their reaction "does appear in the published information" — on the strength
    of a Hepalex label passage that matched the word "Covaxil" nowhere and
    their symptom nowhere either.

    Telling a member of the public their reaction is already known is the one
    thing this screen must not get wrong: it is the answer most likely to make
    somebody decide not to bother.
  */
  const query = slots.reaction ?? "";
  if (query.trim().length === 0) {
    return {
      alreadyDescribed: false,
      consulted: false,
      companyCitations: [],
      publicCitations: [],
    };
  }

  const inScope =
    scope === null ? corpus : corpus.filter((c) => scope.has(c.documentId));
  // Same floor, same reasoning, one definition — see thresholds.ts. The
  // safeguard on this path is not the threshold: it is that the reporter is
  // shown the passage and can see for themselves what it says.
  const options = { limit: 2, minScore: MATCHED_ANY_TERM } as const;

  // The public namespace is readable by anyone; the FDA label is on the web.
  const publicHits = lexicalSearch(inScope, query, {
    ...options,
    sourceType: "public",
  });

  // The company namespace is searched ONLY for a signed-in reviewer.
  const company =
    audience === "reviewer"
      ? lexicalSearch(inScope, query, { ...options, sourceType: "company" })
      : [];

  return {
    alreadyDescribed: company.length > 0 || publicHits.length > 0,
    // Whether any document was available to search, which is a different
    // question from whether the search matched.
    consulted: inScope.length > 0,
    companyCitations: company.map(toCitation),
    publicCitations: publicHits.map(toCitation),
  };
}

function composeVerdict(verdict: IntakeVerdict, slots: IntakeSlots): IntakeMessage[] {
  const citations = [...verdict.companyCitations, ...verdict.publicCitations];

  /*
    Nothing was consulted, so nothing may be claimed about what a label says.

    Not published information "we searched and it is silent" — we hold no
    published information for this medicine at all. Vaccines are the case that
    made this visible: openFDA's drug label dataset carries none of them, so a
    reporter naming a COVID vaccine was told their reaction is not in the
    published information for it, on the strength of a search over an empty
    set.
  */
  if (!verdict.consulted) {
    return [
      {
        role: "assistant",
        citations: [],
        text:
          `Thank you. I looked for the published information for ${slots.drug ?? "this medicine"} and could not find any, so there was nothing for me to check your report against. ` +
          "That is a gap in what I can see, not a finding about what happened to you — a safety reviewer will read this and can check sources I do not have. I am submitting it for review now.",
      },
    ];
  }

  if (!verdict.alreadyDescribed) {
    return [
      {
        role: "assistant",
        citations: [],
        text:
          `Thank you. I could not find ${slots.reaction ?? "this reaction"} in the published information for ${slots.drug ?? "this medicine"}. ` +
          "That does not mean it was not caused by the medicine — it means there is no existing record of it, which is exactly the kind of report a safety reviewer needs to see. I am submitting it for review now.",
      },
    ];
  }

  return [
    {
      role: "assistant",
      citations,
      text:
        `Thank you. ${slots.reaction ?? "This reaction"} does appear in the published information for ${slots.drug ?? "this medicine"}. Here is the passage I found:`,
    },
    {
      role: "assistant",
      citations: [],
      text:
        "That does not close your report. A reviewer still reads every one, and a known reaction can still matter — how severe it was, and how often it is happening. I am submitting it for review now.",
    },
  ];
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export interface AdvanceInput {
  readonly state: IntakeState;
  readonly reply: string;
  readonly corpus: readonly DocumentChunk[];
  /** Substance and brand names already in the library, for drug matching. */
  readonly knownProducts: readonly string[];
  /** Documents held for the named medicine. Null means the whole corpus. */
  readonly scope?: ReadonlySet<DocumentId> | null | undefined;
  /** Who is reading. Decides whether confidential documents may be quoted. */
  readonly audience: Audience;
  /**
   * A verified model extraction of this message, when one was produced.
   *
   * Passed in rather than fetched, so `advance` stays pure and the whole
   * conversation remains testable without a network. Null is the ordinary
   * case, not an error case: it is what every fallback path supplies.
   */
  readonly extraction?: Extraction | null | undefined;
}

/**
 * Apply one reporter message and produce the next assistant turn.
 *
 * Pure. Given the same state, reply and corpus it always produces the same
 * next state, which is what makes the whole conversation testable without a
 * browser or a network.
 */
export function advance(input: AdvanceInput): IntakeState {
  const { state, reply, corpus, knownProducts, audience } = input;
  const trimmed = reply.trim();
  if (trimmed.length === 0 || state.phase === "complete") return state;

  const reporterMessage: IntakeMessage = {
    role: "reporter",
    text: trimmed,
    citations: [],
  };

  // Fill the slot we asked about, then opportunistically read anything else
  // the reply happened to contain.
  let slots = state.slots;
  switch (state.pending) {
    case "narrative":
      slots = { ...slots, narrative: trimmed };
      break;
    case "drug":
      slots = { ...slots, drug: trimmed };
      break;
    case "reaction":
      slots = { ...slots, reaction: trimmed };
      break;
    case "age":
      slots = { ...slots, age: parseAgeAnswer(trimmed) };
      break;
    case "sex":
      slots = { ...slots, sex: extractSex(trimmed) ?? "unknown" };
      break;
    case "seriousness":
      slots = { ...slots, seriousness: extractSeriousness(trimmed) };
      break;
    case "reporterName":
      slots = { ...slots, reporterName: trimmed };
      break;
    case "reporterContact":
      slots = { ...slots, reporterContact: trimmed };
      break;
    case null:
      break;
  }
  slots = interpret(trimmed, slots, knownProducts, input.extraction ?? null);

  // An unparseable answer to a specific question must not be silently dropped;
  // ask again rather than moving on with a null.
  if (state.pending === "age" && slots.age === null) {
    return {
      ...state,
      slots,
      messages: [
        ...state.messages,
        reporterMessage,
        {
          role: "assistant",
          citations: [],
          text: "Sorry — I need that as a number of years. Roughly how old are they?",
        },
      ],
    };
  }

  const missing = nextMissing(slots);
  if (missing !== null) {
    return {
      ...state,
      slots,
      pending: missing,
      messages: [
        ...state.messages,
        reporterMessage,
        { role: "assistant", text: QUESTIONS[missing], citations: [] },
      ],
    };
  }

  const verdict = assessAgainstDocuments(
    slots,
    corpus,
    audience,
    input.scope ?? null,
  );
  return {
    slots,
    pending: null,
    phase: "complete",
    verdict,
    messages: [...state.messages, reporterMessage, ...composeVerdict(verdict, slots)],
  };
}

/** What the reporter still has to supply, for the progress readout. */
export function remainingSlots(slots: IntakeSlots): readonly IntakeSlot[] {
  return ORDER.filter((slot) =>
    slot === "seriousness" ? slots.seriousness === null : slots[slot] === null,
  );
}

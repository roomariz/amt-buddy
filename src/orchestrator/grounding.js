import { parseNumber } from "./numbers.js";

// Grounding check (ADR 0003): every number in an answer must be traceable to a
// Tool result of this turn, a Tenancy fact, or the user's own message.

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;
// Legal citations and list markers are not claims: "§ 7 Abs. 1", "§§ 558c, 558d", "1. ", "2) ".
const CITATION_PART = String.raw`\d+[a-z]?(?:\s*(?:Abs\.|Absatz|Satz|S\.|Nr\.)\s*\d+[a-z]?)*`;
const IGNORED_PATTERNS = [
  new RegExp(String.raw`§+\s*${CITATION_PART}(?:\s*(?:,|und|and|bis|[-–])\s*${CITATION_PART})*`, "gi"),
  /^\s*\d+[.)]\s/gm,
];

function extractNumbers(text) {
  let cleaned = String(text ?? "");
  for (const pattern of IGNORED_PATTERNS) cleaned = cleaned.replace(pattern, " ");
  return (cleaned.match(NUMBER_PATTERN) ?? [])
    .map((token) => ({ token, value: parseNumber(token) }))
    .filter(({ value }) => value !== null);
}

function collect(value, into) {
  if (typeof value === "number") into.add(Math.round(value * 100) / 100);
  else if (typeof value === "string") for (const { value: n } of extractNumbers(value)) into.add(n);
  else if (Array.isArray(value)) for (const item of value) collect(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item, into);
}

function allowedNumbers({ evidence = [], tenancy = {}, userText = "" }) {
  const allowed = new Set();
  collect(evidence.map((entry) => entry.result).filter(Boolean), allowed);
  collect(Object.values(tenancy).map((fact) => fact.value), allowed);
  collect(userText, allowed);
  return allowed;
}

function isAllowed(value, allowed) {
  if (allowed.has(value)) return true;
  // "rund 16 €/m²" for 15.6 is fine; inventing 15 is not.
  return Number.isInteger(value) && [...allowed].some((candidate) => Math.round(candidate) === value);
}

// → { grounded, ungrounded: [token, ...] } (tokens as written, deduplicated).
export function checkGrounding(answer, sources) {
  const allowed = allowedNumbers(sources);
  const ungrounded = extractNumbers(answer)
    .filter(({ value }) => !isAllowed(value, allowed))
    .map(({ token }) => token);
  return { grounded: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}

// A sentence ends at . ! ? followed by whitespace, but not after a list marker
// ("1. ") or a common abbreviation ("Abs. 1", "z. B.").
const SENTENCE_BREAK = /(?<!^\s*\d+[.)])(?<!\b(?:Abs|Nr|S|Art|bzw|ca|vgl|z\.\s?B|e\.\s?g|i\.\s?e)\.)(?<=[.!?])\s+/i;
const MARKER_ONLY = /^\s*(?:[-*•]|\d+[.)])?\s*$/;

// Drops every sentence that contains one of the ungrounded figures; a list item
// left with nothing but its marker goes too.
export function stripUngrounded(answer, ungrounded) {
  const offending = new Set(ungrounded);
  const lines = [];
  for (const line of answer.split("\n")) {
    const kept = line
      .split(SENTENCE_BREAK)
      .filter((sentence) => !extractNumbers(sentence).some(({ token }) => offending.has(token)))
      .join(" ");
    if (line.trim() === "") {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    } else if (!MARKER_ONLY.test(kept)) {
      lines.push(kept);
    }
  }
  return lines.join("\n").trim();
}

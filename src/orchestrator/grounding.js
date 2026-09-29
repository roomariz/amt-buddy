import { parseNumber } from "./numbers.js";

// Grounding check (ADR 0003): every number in an answer must be traceable to a
// Tool result of this turn, a Tenancy fact, or the user's own message.

// A number in German or English notation, or a date ("2024-05-15", "01.05.2013").
const NUMBER_PATTERN = /\d{4}-\d{2}-\d{2}|\d+(?:[.,]\d+)*/g;
// Legal citations and list markers are not claims: "§ 7 Abs. 1", "§§ 558c, 558d",
// "Art. 14 GG", "1. ", "2) ". Only "§§" introduces a list of sections, so in
// "§ 5 und 20 Personen" the 20 stays a claim.
const CITATION_PART = String.raw`\d+[a-z]?(?:\s*(?:Abs\.|Absatz|Satz|S\.|Nr\.)\s*\d+[a-z]?)*`;
const IGNORED_PATTERNS = [
  new RegExp(
    String.raw`§§\s*${CITATION_PART}(?:\s*(?:,|und|and|bis|[-–])\s*${CITATION_PART})*|(?:§|Art\.|Artikel)\s*${CITATION_PART}`,
    "gi",
  ),
  /^\s*\d+[.)]\s/gm,
];

// → [{ token, value }]; value is null for a token that is not a plain number
// (a date), which is then only grounded by the same token in a source.
function extractNumbers(text) {
  let cleaned = String(text ?? "");
  for (const pattern of IGNORED_PATTERNS) cleaned = cleaned.replace(pattern, " ");
  return (cleaned.match(NUMBER_PATTERN) ?? []).map((token) => ({ token, value: parseNumber(token) }));
}

// A number in an answer carries no sign ("170 € below the cap"), so a source figure
// grounds its magnitude: -170 grounds 170.
function collect(value, into) {
  if (typeof value === "number") into.values.add(Math.round(Math.abs(value) * 100) / 100);
  else if (typeof value === "string") {
    for (const { token, value: n } of extractNumbers(value)) {
      if (n === null) into.tokens.add(token);
      else into.values.add(n);
    }
  } else if (Array.isArray(value)) for (const item of value) collect(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item, into);
}

function groundedFigures({ evidence = [], tenancy = {}, userText = "" }) {
  const figures = { values: new Set(), tokens: new Set() };
  collect(evidence.map((entry) => entry.result).filter(Boolean), figures);
  collect(Object.values(tenancy).map((fact) => fact.value), figures);
  collect(userText, figures);
  return figures;
}

function isGrounded({ token, value }, figures) {
  if (value === null) return figures.tokens.has(token);
  if (figures.values.has(value)) return true;
  // "rund 16 €/m²" for 15.6 is fine; inventing 15 is not.
  return Number.isInteger(value) && [...figures.values].some((candidate) => Math.round(candidate) === value);
}

// → { grounded, ungrounded: [token, ...] } (tokens as written, deduplicated).
export function checkGrounding(answer, sources) {
  const figures = groundedFigures(sources);
  const ungrounded = extractNumbers(answer)
    .filter((number) => !isGrounded(number, figures))
    .map(({ token }) => token);
  return { grounded: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}

// A sentence ends at . ! ? followed by whitespace, but not after a list marker
// ("1. "), a single letter ("z. B.", "e.g.") or a common abbreviation ("Abs. 1").
const SENTENCE_BREAK = /(?<!^\s*\d+[.)])(?<!\b(?:[a-z]|Abs|Nr|Art|bzw|ca|vgl)\.)(?<=[.!?])\s+/i;
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

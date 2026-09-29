import { checkGrounding, stripUngrounded } from "../../orchestrator/grounding.js";

// The grounding check (ADR 0003) for the landlord side: every number in an answer must come from a
// Tool result of this turn, the landlord's state in the system prompt (the Listing, its Rent check,
// the pool statistics, the Landlord preferences, the top of the ranking and the Shortlist) or the
// landlord's own message of this turn.
// Applicant ids ("A-007") are names, not figures: they are never checked.

const APPLICANT_ID = /\b[A-Z]-\d+\b/g;
const PLACEHOLDER = /([a-z]+)/g;

// Letters only, so a placeholder carries no digit the check could see.
const letters = (index) => index.toString(26).replace(/./g, (digit) => String.fromCharCode(97 + parseInt(digit, 26)));

function maskIds(text) {
  const ids = new Map();
  const masked = String(text ?? "").replace(APPLICANT_ID, (id) => {
    const key = letters(ids.size);
    ids.set(key, id);
    return `${key}`;
  });
  return { masked, unmask: (value) => value.replace(PLACEHOLDER, (match, key) => ids.get(key) ?? match) };
}

// A ratio is written as a percentage ("19.3 %" for 0.1933) or to three decimals ("0.193"), neither of
// which the shared check derives from the raw value. Ratio fields are recognised by their key, not
// by a value between 0 and 1: that would let "50 %" pass whenever some subscore is 0.5, and a wrongly
// grounded figure reaches the landlord as fact, while a wrongly stripped one only costs a sentence.
const RATIO_KEYS = new Set(["rentToIncome", "maxRentToIncome"]);

function ratiosIn(value, into = []) {
  if (Array.isArray(value)) for (const item of value) ratiosIn(item, into);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (RATIO_KEYS.has(key) && typeof item === "number") into.push(item);
      else ratiosIn(item, into);
    }
  }
  return into;
}

// Handed over as text, so each form is parsed exactly as the answer's own figure is ("0.193" reads
// as 193 there, a dot before three digits being a thousands separator).
const ratioForms = (ratio) => [`${Math.round(ratio * 1000) / 10}`, `${Math.round(ratio * 100)}`, `${Math.round(ratio * 1000) / 1000}`];

// sources: { evidence: [{ result? }], context, userText } → { grounded, ungrounded: [token, ...] }
export function checkLandlordAnswer(answer, { evidence = [], context = {}, userText = "" }) {
  const { masked } = maskIds(answer);
  const derivedRatioForms = ratiosIn([evidence.map((entry) => entry.result), context]).flatMap(ratioForms);
  return checkGrounding(masked, { evidence: [...evidence, { result: context }, { result: { derivedRatioForms } }], userText });
}

// A lead-in: a line ending with ":" (markdown emphasis after it allowed), its list on the lines below.
const LEAD_IN = /:[*_\s]*$/;

// The lines without each lead-in whose list was stripped: one that had a line right below it in the
// answer and now has nothing below it before a blank line or the end. A lead-in followed by a blank
// line in the answer ("Top applicants:\n\n- A-001 …") is always kept, so a surviving list is never
// orphaned; a lead-in the sentence strip itself shortened is kept too. Both keep a dangling line at
// worst, the cheap direction: dropping a lead-in wrongly removes a line from an intact answer.
function withoutOrphanedLeadIns(stripped, answer) {
  const answerLines = answer.split("\n");
  const leadIns = new Set(answerLines.filter((line, index) => LEAD_IN.test(line) && answerLines[index + 1]?.trim()).map((line) => line.trim()));
  const lines = stripped.split("\n");
  const kept = lines.filter((line, index) => !(leadIns.has(line.trim()) && !lines[index + 1]?.trim()));
  return kept.filter((line, index) => line.trim() !== "" || (index > 0 && kept[index - 1].trim() !== "")).join("\n").trim();
}

// The answer without its sentences that contain one of the ungrounded figures, and without a lead-in
// left with nothing under it.
export function stripUngroundedFigures(answer, ungrounded) {
  const { masked, unmask } = maskIds(answer);
  return withoutOrphanedLeadIns(unmask(stripUngrounded(masked, ungrounded)), String(answer ?? ""));
}

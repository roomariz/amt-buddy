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

// The answer without its sentences that contain one of the ungrounded figures.
export function stripUngroundedFigures(answer, ungrounded) {
  const { masked, unmask } = maskIds(answer);
  return unmask(stripUngrounded(masked, ungrounded));
}

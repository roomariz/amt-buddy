import { checkGrounding, stripUngrounded } from "../../orchestrator/grounding.js";

// The grounding check (ADR 0003) for the landlord side: every number in an answer must come from a
// Tool result of this turn, the landlord's state in the system prompt (the Listing, its Rent check,
// the pool statistics, the Landlord preferences) or the landlord's own message of this turn.
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

// sources: { evidence: [{ result? }], context, userText } → { grounded, ungrounded: [token, ...] }
export function checkLandlordAnswer(answer, { evidence = [], context = {}, userText = "" }) {
  const { masked } = maskIds(answer);
  return checkGrounding(masked, { evidence: [...evidence, { result: context }], userText });
}

// The answer without its sentences that contain one of the ungrounded figures.
export function stripUngroundedFigures(answer, ungrounded) {
  const { masked, unmask } = maskIds(answer);
  return unmask(stripUngrounded(masked, ungrounded));
}

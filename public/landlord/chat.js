// The /landlord page's chat panel as plain data (no DOM): one turn of the Landlord Orchestrator
// (docs/api.md, "POST /api/v1/landlord/:landlordId/chat") folded into what the panel shows.

import { escapeHtml, renderMarkdown } from "../chat/markdown.js";
import { createSseParser } from "../chat/sse.js";
import { TURN_TEXT } from "../chat/turn.js";

export function initialLandlordTurn() {
  return { phase: "streaming", answer: "", error: null, changed: { criteria: false, shortlist: false, notes: false, flat: false }, signedOut: false };
}

// Pure: reduceLandlordTurn(state, event) → new state. Events after the terminal one are ignored.
export function reduceLandlordTurn(state, event) {
  if (state.phase !== "streaming" || !event || typeof event.type !== "string") return state;
  switch (event.type) {
    case "token":
      return { ...state, answer: state.answer + (typeof event.text === "string" ? event.text : "") };
    case "criteria":
    case "shortlist":
    case "notes":
    case "flat":
      return { ...state, changed: { ...state.changed, [event.type]: true } };
    case "done":
      return { ...state, phase: "done" };
    case "error":
      // The event's message is technical: show our own text.
      return { ...state, phase: "error", error: TURN_TEXT.failed };
    default:
      return state;
  }
}

// The response ended (or the connection broke). Without a terminal event, the turn failed.
export function endLandlordTurn(state) {
  if (state.phase !== "streaming") return state;
  return { ...state, phase: "error", error: TURN_TEXT.connectionLost };
}

// Runs one chat turn for `message`, calling onChange(next, previous) on every change. Resolves with
// the final state, always in phase "done" or "error"; `signedOut` is true when the server does not
// know the landlord; `changed` says whether the turn changed the Selection criteria, the Shortlist,
// the remembered Landlord preferences (notes) or the flat details (flat).
export async function runLandlordTurn({ fetchImpl, landlordId, message, onChange = () => {} }) {
  let state = initialLandlordTurn();
  const commit = (next) => {
    if (next === state) return;
    const previous = state;
    state = next;
    onChange(state, previous);
  };
  const apply = (events) => {
    for (const event of events) commit(reduceLandlordTurn(state, event));
  };

  let response;
  try {
    response = await fetchImpl(`/api/v1/landlord/${encodeURIComponent(landlordId)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    commit(endLandlordTurn(state));
    return state;
  }
  if (!response.ok || !response.body) {
    // A request the server rejects before streaming (422 / 404 JSON).
    if (response.status === 404) commit({ ...state, signedOut: true });
    apply([{ type: "error" }]);
    return state;
  }

  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    while (state.phase === "streaming") {
      const { value, done } = await reader.read();
      if (done) break;
      apply(parser.push(decoder.decode(value, { stream: true })));
    }
    apply(parser.push(decoder.decode()));
    apply(parser.flush());
  } catch {
    // The connection broke or the turn was cancelled: endLandlordTurn reports it.
  }
  // After the done or error event the server still closes the response. Cancelling it here would
  // show in DevTools as a failed request (net::ERR_ABORTED), so the rest is read in the background
  // and dropped; the turn does not wait for it.
  drain(reader);
  commit(endLandlordTurn(state));
  return state;
}

// Reads a response to its end without using it, then releases it. Never throws.
async function drain(reader) {
  try {
    while (!(await reader.read()).done);
    reader.releaseLock();
  } catch {
    // Broken after the turn ended: nothing left to report.
  }
}

// Whether the turn changed what the dashboard shows (the Selection criteria, the Shortlist, the
// remembered preferences or the flat details), so the page fetches it again. A change saved before the turn failed
// still counts.
export function changedDashboard(state) {
  return Object.values(state?.changed ?? {}).some(Boolean);
}

// The applicants' names by id, from the dashboard (ranked, excluded and the Shortlist).
export function applicantNames(dashboard) {
  const names = new Map();
  for (const list of [dashboard?.ranked, dashboard?.excluded, dashboard?.shortlist]) {
    for (const { applicantId, name } of list ?? []) if (name) names.set(applicantId, name);
  }
  return names;
}

// After a turn that changed the ranking the model writes two parts separated by a line that is only
// "---" (the system prompt asks for it): splitAnswer(text) → [first, second], second null when there
// is no second part. While the answer streams, a trailing "-" or "--" line may be the separator
// being typed, so it does not show.
export function splitAnswer(text) {
  const lines = String(text ?? "").split("\n");
  const at = lines.findIndex((line) => line.trim() === "---");
  if (at === -1) {
    if (/^-{1,2}$/.test(lines.at(-1).trim())) lines.pop();
    return [lines.join("\n").trim(), null];
  }
  return [lines.slice(0, at).join("\n").trim(), lines.slice(at + 1).join("\n").trim() || null];
}

const APPLICANT_ID = /\b[A-Z]-\d+\b/g;

// The model only knows applicant ids ("A-007"): the panel adds the name after each id it knows.
export function withApplicantNames(answer, names) {
  return String(answer ?? "").replace(APPLICANT_ID, (id) => (names.has(id) ? `${id} (${names.get(id)})` : id));
}

// The answer's HTML for the page, with the names after the ids. Names are untrusted (a landlord
// can type anything, also "[x](https://…)" or "<img …>"), so they join after renderMarkdown, escaped,
// and only in the text between tags, never inside a tag or an attribute.
export function renderAnswerWithNames(answer, names) {
  return renderMarkdown(String(answer ?? ""))
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith("<") ? part : part.replace(APPLICANT_ID, (id) => (names.has(id) ? `${id} (${escapeHtml(names.get(id))})` : id)),
    )
    .join("");
}

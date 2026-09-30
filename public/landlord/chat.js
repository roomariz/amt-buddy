// The /landlord page's chat panel as plain data (no DOM): one turn of the Landlord Orchestrator
// (docs/api.md, "POST /api/v1/landlord/:landlordId/chat") folded into what the panel shows.

import { createSseParser } from "../chat/sse.js";
import { TURN_TEXT } from "../chat/turn.js";

export function initialLandlordTurn() {
  return { phase: "streaming", answer: "", error: null, changed: { criteria: false, shortlist: false, notes: false }, signedOut: false };
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
// know the landlord; `changed` says whether the turn changed the Selection criteria, the Shortlist or
// the remembered Landlord preferences (notes).
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
  } finally {
    if (state.phase !== "streaming") reader.cancel().catch(() => {});
  }
  commit(endLandlordTurn(state));
  return state;
}

// Whether the turn changed what the dashboard shows (the Selection criteria, the Shortlist or the
// remembered preferences), so the page fetches it again. A change saved before the turn failed
// still counts.
export function changedDashboard(state) {
  return Object.values(state?.changed ?? {}).some(Boolean);
}

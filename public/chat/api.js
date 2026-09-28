// The /chatbot page's calls to the server (docs/orchestrator.md, "HTTP and SSE interface").
// `fetchImpl` is the browser's fetch; tests pass a fake or run against the real app.

import { createSseParser } from "./sse.js";
import { endTurn, initialTurn, reduceTurn } from "./turn.js";

export const UPLOAD_TEXT = {
  noTextLayer:
    "In diesem PDF ist kein lesbarer Text (zum Beispiel ein eingescannter Vertrag). Bitte laden Sie ein PDF mit Text oder eine Textdatei hoch.",
  image: "Bilder von Mietverträgen können noch nicht gelesen werden. Bitte laden Sie ein PDF mit Text oder eine Textdatei hoch.",
  tooLarge: "Die Datei ist zu groß (höchstens 15 MB).",
  empty: "Das Dokument ist leer.",
  failed: "Der Mietvertrag konnte nicht hochgeladen werden. Bitte versuchen Sie es noch einmal.",
};

const UPLOAD_REASONS = {
  ocr_no_text: UPLOAD_TEXT.noTextLayer,
  image_ocr_provider_required: UPLOAD_TEXT.image,
  file_too_large: UPLOAD_TEXT.tooLarge,
  empty_text: UPLOAD_TEXT.empty,
};

const postJson = (fetchImpl, url, body, signal) =>
  fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

// "orchestrator" or "rule_based"; null when the status cannot be read.
export async function fetchChatMode(fetchImpl) {
  try {
    const response = await fetchImpl("/api/v1/orchestrator/status");
    if (!response.ok) return null;
    const mode = (await response.json())?.data?.mode;
    return mode === "orchestrator" || mode === "rule_based" ? mode : null;
  } catch {
    return null;
  }
}

// Uploads a lease ({ file: base64, mimeType, fileName } or { text }) → { documentId }.
// Throws an Error whose message is a friendly German reason.
export async function uploadLease({ fetchImpl, payload, signal }) {
  let response;
  let body;
  try {
    response = await postJson(fetchImpl, "/api/v1/orchestrator/documents", payload, signal);
    body = await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(UPLOAD_TEXT.failed);
  }
  const documentId = body?.data?.documentId;
  if (response.ok && typeof documentId === "string") return { documentId };
  const code = body?.error?.details?.[0]?.code;
  throw new Error(UPLOAD_REASONS[code] ?? UPLOAD_TEXT.failed);
}

// Runs one chat turn: posts `request` ({ threadId, message?, documentId?, confirm? }), folds the
// streamed events into the turn's view model and calls onChange(next, previous) on every change.
// Resolves with the final state; it always ends in phase "done" or "error".
export async function runTurn({ fetchImpl, request, signal, onChange = () => {} }) {
  let state = initialTurn();
  const apply = (events) => {
    for (const event of events) {
      const next = reduceTurn(state, event);
      if (next !== state) {
        const previous = state;
        state = next;
        onChange(state, previous);
      }
    }
  };
  const finish = () => {
    const next = endTurn(state);
    if (next !== state) {
      const previous = state;
      state = next;
      onChange(state, previous);
    }
    return state;
  };

  let response;
  try {
    response = await postJson(fetchImpl, "/api/v1/orchestrator/chat", request, signal);
  } catch {
    return finish();
  }
  if (!response.ok || !response.body) {
    // A request the server rejects before streaming (422 JSON): show the friendly error.
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
    // The connection broke or the turn was cancelled: finish() reports it.
  } finally {
    if (state.phase !== "streaming") reader.cancel().catch(() => {});
  }
  return finish();
}

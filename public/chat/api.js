// The /chatbot page's calls to the server (docs/orchestrator.md, "HTTP and SSE interface").
// `fetchImpl` is the browser's fetch; tests pass a fake or run against the real app.

import { t } from "../i18n.js";
import { createSseParser } from "./sse.js";
import { endTurn, initialTurn, reduceTurn } from "./turn.js";

// Upload reasons in the current UI language (getters: read when an upload fails).
export const UPLOAD_TEXT = {
  get noTextLayer() {
    return t("upload.noTextLayer");
  },
  get image() {
    return t("upload.image");
  },
  get tooLarge() {
    return t("upload.tooLarge");
  },
  get empty() {
    return t("upload.empty");
  },
  get failed() {
    return t("upload.failed");
  },
};

// The server's reason codes → UPLOAD_TEXT names.
const UPLOAD_REASONS = {
  ocr_no_text: "noTextLayer",
  image_ocr_provider_required: "image",
  file_too_large: "tooLarge",
  empty_text: "empty",
};

const postJson = (fetchImpl, url, body, signal) =>
  fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

// How the sidebar names each chat mode.
export const MODE_LABEL = {
  get orchestrator() {
    return t("mode.orchestrator");
  },
  get rule_based() {
    return t("mode.rule_based");
  },
};

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
// Throws an Error whose message is a friendly reason in the UI language.
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
  throw new Error(UPLOAD_TEXT[UPLOAD_REASONS[code] ?? "failed"]);
}

// Runs one chat turn: posts `request` ({ threadId, message?, documentId?, confirm? }), folds the
// streamed events into the turn's view model and calls onChange(next, previous) on every change.
// Resolves with the final state; it always ends in phase "done" or "error".
export async function runTurn({ fetchImpl, request, signal, onChange = () => {} }) {
  let state = initialTurn();
  const commit = (next) => {
    if (next === state) return;
    const previous = state;
    state = next;
    onChange(state, previous);
  };
  const apply = (events) => {
    for (const event of events) commit(reduceTurn(state, event));
  };
  const finish = () => {
    commit(endTurn(state));
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

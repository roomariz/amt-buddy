/**
 * Amt-Buddy /chatbot page: a free-text chat with the Orchestrator over
 * POST /api/v1/orchestrator/chat (Server-Sent Events). In rule_based mode the same endpoint
 * answers with the rule-based chatbot, so there is one code path.
 *
 * The logic lives in ./chat/ (SSE parsing, the turn view model, Markdown, the review card,
 * the thread id); this file only wires it to the DOM. Model output reaches the page only
 * through renderMarkdown, which escapes everything first. Nothing here logs messages or uploads.
 */

import { fetchChatMode, runTurn, uploadLease, UPLOAD_TEXT } from "./chat/api.js";
import { renderMarkdown } from "./chat/markdown.js";
import { confirmPayload, inputModeFor } from "./chat/tenancy.js";
import { currentThreadId, startNewThread } from "./chat/thread.js";
import { announcements } from "./chat/turn.js";

const $ = (selector) => document.querySelector(selector);

const chatStream = $("#chat-stream");
const gptHero = $("#gpt-hero");
const gptScrollContainer = $("#gpt-scroll-container");
const chatInputForm = $("#chat-input-form");
const chatUserInput = $("#chat-user-input");
const chatFileInput = $("#chat-file-input");
const chatUploadBtn = $("#chat-upload-btn");
const chatSendBtn = $("#chat-send-btn");
const btnNewChat = $("#btn-new-chat");
const sidebarToggleBtn = $("#sidebar-toggle-btn");
const gptSidebar = $("#gpt-sidebar");
const heroUploadCard = $("#hero-upload-card");
const btnHeroSelectFile = $("#btn-hero-select-file");
const attachmentPreview = $("#attachment-preview");
const chipFileName = $("#chip-file-name");
const chipFileRemove = $("#chip-file-remove");
const modeNote = $("#mode-note");
const modeLabel = $("#chat-mode-label");
const liveRegion = $("#chat-live");

const MAX_FILE_BYTES = 15 * 1024 * 1024; // the upload endpoint's limit

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let threadId = currentThreadId(localStore(), newId);
let stagedFile = null;
let busy = false;
let activeTurn = null; // AbortController of the running turn

// --- small DOM helpers -------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scrollToBottom() {
  if (gptScrollContainer) gptScrollContainer.scrollTop = gptScrollContainer.scrollHeight;
}

function showChatView() {
  if (gptHero) gptHero.hidden = true;
}

function announce(lines) {
  if (!liveRegion || lines.length === 0) return;
  for (const line of lines) liveRegion.append(el("p", "", line));
  // Keep the region short: old lines have been read already.
  while (liveRegion.childElementCount > 6) liveRegion.firstElementChild.remove();
}

function resizeInput() {
  chatUserInput.style.height = "auto";
  chatUserInput.style.height = `${Math.min(chatUserInput.scrollHeight, 160)}px`;
  chatUserInput.style.overflowY = chatUserInput.scrollHeight > 160 ? "auto" : "hidden";
}

function setBusy(value) {
  busy = value;
  chatStream.setAttribute("aria-busy", String(value));
  for (const control of [chatUserInput, chatSendBtn, chatUploadBtn, btnHeroSelectFile]) {
    if (control) control.disabled = value;
  }
  for (const button of document.querySelectorAll(".hero-suggestions .bot-option-btn")) button.disabled = value;
}

function setStagedFile(file) {
  stagedFile = file;
  if (!file) {
    attachmentPreview.hidden = true;
    chatFileInput.value = "";
    return;
  }
  chipFileName.textContent = `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
  attachmentPreview.hidden = false;
  chatUserInput.focus();
}

// --- messages ----------------------------------------------------------------------------------

function appendUserMessage(text, file = null) {
  showChatView();
  const row = el("div", "chat-msg-row user-row");
  const bubble = el("div", "user-bubble");
  if (file) {
    const chip = el("div", "user-file-chip");
    chip.append(
      el("span", "chip-icon", "📄"),
      el("span", "chip-name", file.name),
      el("span", "chip-size", `(${Math.max(1, Math.round(file.size / 1024))} KB)`),
    );
    bubble.append(chip);
  }
  if (text) bubble.append(el("div", "user-msg-text", text));
  row.append(bubble);
  chatStream.append(row);
  scrollToBottom();
}

// One Amt-Buddy reply: step chips, the answer, an error line and (maybe) the review card.
function appendBotTurn() {
  showChatView();
  const row = el("div", "chat-msg-row bot-row");
  const avatar = el("div", "bot-avatar", "🏛️");
  avatar.setAttribute("aria-hidden", "true");
  const bubble = el("div", "bot-bubble");
  const header = el("div", "bot-header");
  header.append(el("span", "bot-name", "Amt-Buddy"), el("span", "bot-tag", "Offizielle Prüfung · Berlin Open Data"));
  const steps = el("ul", "agent-steps");
  steps.setAttribute("aria-label", "Arbeitsschritte");
  const pending = el("p", "turn-pending", "Amt-Buddy arbeitet …");
  const content = el("div", "bot-content");
  const error = el("p", "turn-error");
  error.hidden = true;
  const extra = el("div", "turn-extra");
  bubble.append(header, steps, pending, content, error, extra);
  row.append(avatar, bubble);
  chatStream.append(row);
  scrollToBottom();
  return { row, steps, pending, content, error, extra };
}

function renderStepChip(list, { key, status, label }) {
  let chip = list.querySelector(`[data-step="${key}"]`);
  if (!chip) {
    chip = el("li", "step-chip");
    chip.dataset.step = key;
    const icon = el("span", "step-icon");
    icon.setAttribute("aria-hidden", "true");
    chip.append(icon, el("span", "step-label"));
    list.append(chip);
  }
  chip.className = `step-chip is-${status.replace("_", "-")}`;
  chip.querySelector(".step-label").textContent = label;
}

function renderTurn(view, state) {
  for (const step of state.steps) renderStepChip(view.steps, { key: step.id, status: step.status, label: step.label });
  // Only the escaping Markdown renderer ever writes HTML from model output.
  view.content.innerHTML = renderMarkdown(state.answer);
  view.pending.hidden = state.phase !== "streaming" || state.steps.some((s) => s.status === "running") || !!state.answer;
  view.error.hidden = !state.error;
  view.error.textContent = state.error ?? "";
  scrollToBottom();
}

// --- review card (Unconfirmed facts) ---------------------------------------------------------

const LEVEL_TEXT = { high: "sicher erkannt", medium: "unsicher erkannt", low: "sehr unsicher erkannt" };

function renderReviewCard(view, review) {
  const form = el("form", "doc-result-card review-card");
  const titleId = `review-title-${Date.now().toString(36)}`;
  form.setAttribute("aria-labelledby", titleId);
  const title = el("div", "doc-title", "📋 Werte aus Ihrem Mietvertrag prüfen");
  title.id = titleId;
  const hint = el(
    "p",
    "review-hint",
    "Gelb und rot markierte Werte sind unsicher erkannt. Bitte prüfen oder korrigieren Sie sie – erst dann rechnet Amt-Buddy damit.",
  );
  const grid = el("div", "doc-fact-grid");
  for (const field of review.fields) {
    const item = el("label", `doc-fact-item review-field conf-${field.level}`);
    const inputId = `review-${field.name}-${titleId}`;
    item.htmlFor = inputId;
    const caption = el("span", "", field.label + (field.unit ? ` (${field.unit})` : ""));
    const input = el("input", "review-input");
    input.id = inputId;
    input.name = field.name;
    input.value = field.value;
    input.required = field.unconfirmed;
    input.autocomplete = "off";
    input.inputMode = inputModeFor(field.name);
    const confidence = el(
      "small",
      "review-confidence",
      field.confidence === null ? "ohne Angabe zur Sicherheit" : `${LEVEL_TEXT[field.level]} (${Math.round(field.confidence * 100)} %)`,
    );
    confidence.id = `${inputId}-confidence`;
    input.setAttribute("aria-describedby", confidence.id);
    item.append(caption, input, confidence);
    grid.append(item);
  }
  const submit = el("button", "btn-select-file review-submit", "Werte bestätigen und prüfen");
  submit.type = "submit";
  form.append(title, hint, grid, submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const inputs = Object.fromEntries(new FormData(form).entries());
    const confirm = confirmPayload(review.fields, inputs);
    if (Object.keys(confirm).length === 0) return;
    for (const control of form.elements) control.disabled = true;
    const summary = review.fields
      .filter((field) => field.name in confirm)
      .map((field) => `${field.label}: ${confirm[field.name]}${field.unit ? ` ${field.unit}` : ""}`)
      .join(", ");
    sendTurn({ confirm }, { text: `Werte bestätigt – ${summary}` });
  });

  view.extra.append(form);
  scrollToBottom();
  form.querySelector("input:required")?.focus();
}

// --- turns -------------------------------------------------------------------------------------

// Sends one turn. `request` holds message / documentId / confirm; `shown` is what the user bubble
// shows ({ text, file }). A staged file is uploaded first and sent as documentId.
async function sendTurn(request, shown, file = null) {
  if (busy) return;
  setBusy(true);
  const controller = new AbortController();
  activeTurn = controller;
  const turnThread = threadId;
  appendUserMessage(shown.text, file);
  const view = appendBotTurn();
  let reviewShown = false;

  try {
    let documentId;
    if (file) {
      renderStepChip(view.steps, { key: "upload", status: "running", label: "Lade Ihren Mietvertrag hoch …" });
      view.pending.hidden = true;
      announce(["Lade Ihren Mietvertrag hoch …"]);
      try {
        ({ documentId } = await uploadLease({ fetchImpl: fetch, payload: await filePayload(file), signal: controller.signal }));
        renderStepChip(view.steps, { key: "upload", status: "done", label: "Mietvertrag hochgeladen" });
      } catch (error) {
        if (controller.signal.aborted) return;
        renderStepChip(view.steps, { key: "upload", status: "failed", label: "Hochladen fehlgeschlagen" });
        view.error.textContent = error.message || UPLOAD_TEXT.failed;
        view.error.hidden = false;
        announce([view.error.textContent]);
        return;
      }
    }

    const state = await runTurn({
      fetchImpl: fetch,
      request: { threadId: turnThread, ...request, ...(documentId ? { documentId } : {}) },
      signal: controller.signal,
      onChange: (next, previous) => {
        if (controller.signal.aborted) return;
        renderTurn(view, next);
        announce(announcements(previous, next));
      },
    });
    if (controller.signal.aborted) return;
    if (state.review) {
      renderReviewCard(view, state.review);
      reviewShown = true;
    }
  } finally {
    if (activeTurn === controller) {
      activeTurn = null;
      setBusy(false);
      if (!reviewShown) chatUserInput.focus();
    }
  }
}

function guessMimeType(file) {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".json")) return "application/json";
  return "text/plain";
}

async function filePayload(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(UPLOAD_TEXT.tooLarge);
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(UPLOAD_TEXT.failed));
    reader.readAsDataURL(file);
  });
  return { file: base64, mimeType: guessMimeType(file), fileName: file.name };
}

function submitInput() {
  if (busy) return;
  const text = chatUserInput.value.trim();
  const file = stagedFile;
  if (!text && !file) return;
  chatUserInput.value = "";
  resizeInput();
  setStagedFile(null);
  sendTurn(text ? { message: text } : {}, { text }, file);
}

function resetToNewChat() {
  activeTurn?.abort(); // cancels the running turn on the server too
  activeTurn = null;
  setBusy(false);
  threadId = startNewThread(localStore(), newId);
  setStagedFile(null);
  chatStream.replaceChildren();
  if (liveRegion) liveRegion.replaceChildren();
  if (gptHero) gptHero.hidden = false;
  chatUserInput.value = "";
  resizeInput();
  chatUserInput.focus();
}

async function showChatMode() {
  const mode = await fetchChatMode(fetch);
  if (modeNote) modeNote.hidden = mode !== "rule_based";
  if (modeLabel) modeLabel.textContent = mode === "rule_based" ? "Regelmodus" : mode === "orchestrator" ? "KI-Chat" : "Chat";
}

// --- event listeners ---------------------------------------------------------------------------

chatInputForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitInput();
});

chatUserInput.addEventListener("input", resizeInput);

chatUserInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitInput();
  }
});

btnNewChat?.addEventListener("click", resetToNewChat);

sidebarToggleBtn?.addEventListener("click", () => {
  const collapsed = gptSidebar?.classList.toggle("collapsed");
  sidebarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
});

chatUploadBtn?.addEventListener("click", () => chatFileInput.click());

btnHeroSelectFile?.addEventListener("click", (event) => {
  event.stopPropagation();
  chatFileInput.click();
});

heroUploadCard?.addEventListener("click", () => {
  if (!busy) chatFileInput.click();
});

heroUploadCard?.addEventListener("dragover", (event) => {
  event.preventDefault();
  heroUploadCard.classList.add("drag-over");
});

heroUploadCard?.addEventListener("dragleave", () => heroUploadCard.classList.remove("drag-over"));

heroUploadCard?.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  heroUploadCard.classList.remove("drag-over");
  const file = event.dataTransfer?.files?.[0];
  if (file) setStagedFile(file);
});

chatFileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) setStagedFile(file);
});

chipFileRemove?.addEventListener("click", () => {
  setStagedFile(null);
  chatUserInput.focus();
});

// A file dropped anywhere on the page is staged as the lease.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) setStagedFile(file);
});

// Suggestion prompts send their question as a normal message.
document.addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-prompt]");
  if (!suggestion || busy) return;
  const prompt = suggestion.getAttribute("data-prompt");
  sendTurn({ message: prompt }, { text: prompt });
});

// --- start -------------------------------------------------------------------------------------

sidebarToggleBtn?.setAttribute("aria-expanded", "true");
sidebarToggleBtn?.setAttribute("aria-controls", "gpt-sidebar");
showChatMode();
chatUserInput.focus();

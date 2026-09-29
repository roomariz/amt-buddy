/**
 * Amt-Buddy /landlord-chat page, the chat-first prototype beside the classic /landlord dashboard:
 * two Recommendation slots and the pool at a glance on the left, the chat with the Landlord
 * Orchestrator in the middle (with rotating tips under the prompt), the Shortlist on the right.
 * The Selection criteria and the flat details change through the chat only.
 *
 * The logic lives in ./landlord/ (server calls, the slots and sidebar, tips, avatars, rank moves,
 * the stored sign-in); this file only wires it to the DOM. Names and model answers are untrusted:
 * they go in as textContent, answers through renderAnswerWithNames (Markdown escaped first, names
 * escaped and added after rendering, never parsed). Only avatarSvg's code-generated markup goes
 * through innerHTML.
 */

import { fetchOverview, removeShortlistEntry, saveShortlistEntry, signIn } from "./landlord/api.js";
import { avatarSvg } from "./landlord/avatar.js";
import { fillSlots, sidebarRows, slotCard } from "./landlord/board.js";
import { applicantNames, changedDashboard, renderAnswerWithNames, runLandlordTurn } from "./landlord/chat.js";
import { statTiles } from "./landlord/pool-overview.js";
import { moveText, rankMoves } from "./landlord/rank-moves.js";
import { forgetLandlord, rememberLandlord, storedLandlord } from "./landlord/session.js";
import { landlordTips } from "./landlord/tips.js";
import { onLanguageChange, startI18n, t } from "./i18n.js";

const $ = (selector) => document.querySelector(selector);

const signInWrap = $("#sign-in-wrap");
const signInForm = $("#sign-in-form");
const signInName = $("#sign-in-name");
const signInError = $("#sign-in-error");
const nameLabel = $("#landlord-name");
const signOutButton = $("#btn-sign-out");
const board = $("#board");
const boardError = $("#board-error");
const slotList = $("#slots");
const tileList = $("#glance-tiles");
const poolErrors = $("#pool-errors");
const chatMessages = $("#chat-messages");
const chatWelcome = $("#chat-welcome");
const chatForm = $("#chat-form");
const chatInput = $("#chat-input");
const chatSendButton = $("#btn-chat-send");
const tipBox = $("#tip");
const tipBody = $("#tip-body");
const shortlistError = $("#shortlist-error");
const shortlistList = $("#shortlist-list");
const shortlistEmpty = $("#shortlist-empty");

const TIP_INTERVAL_MS = 8000;
const FLIGHT_MS = 350;

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let landlord = storedLandlord(localStore());
let overview = null; // GET overview; null until loaded
let namesById = new Map(); // applicant id → name, from the overview, for the chat answers
let slots = [null, null]; // applicant ids in the two Recommendation slots
// Skipped applicants, page state only (forgotten on reload). Cleared when the ranking changes,
// since a skipped applicant may deserve another look under new criteria or flat details.
let skipped = new Set();
// Rank moves from the last ranking change (criteria or flat details); shown until the next one.
let moves = new Map();
// Applicants with an add or remove request running: their buttons stay disabled across redraws,
// so a double click cannot send the change twice.
const pending = new Set();
let overviewRequest = 0;
let streaming = false;
let tips = [];
let tipIndex = 0;
let tipTimer = null;
let tipHovered = false;
let tipFocused = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(node, message) {
  node.textContent = message ?? "";
  node.hidden = !message;
}

// The avatar is the only markup that goes in as HTML: avatarSvg builds it from a fixed shape list
// and its own texts, never from applicant data.
function avatar(shape, size) {
  const node = el("span", size < 48 ? "lc-avatar is-small" : "lc-avatar");
  node.innerHTML = avatarSvg(shape, { size });
  return node;
}

// "↑2" beside a rank, spoken as "moved up 2"; nothing when the applicant did not move.
function moveBadge(applicantId) {
  const move = moveText(moves.get(applicantId));
  if (!move) return null;
  const badge = el("span", `lc-move ${moves.get(applicantId) > 0 ? "is-up" : "is-down"}`);
  const text = el("span", "", move.text);
  text.setAttribute("aria-hidden", "true");
  badge.append(text, el("span", "visually-hidden", move.label));
  return badge;
}

// Puts `text` into the prompt and focuses it, with the cursor at the end.
function toPrompt(text) {
  chatInput.value = text;
  chatInput.focus();
  chatInput.setSelectionRange(text.length, text.length);
}

// A button that was disabled while its request ran has lost the focus to the page: give it to the
// control with the same data-focus-key in the redrawn board, unless the landlord has moved on.
function restoreFocus(key) {
  const active = document.activeElement;
  if (key && (!active || active === document.body)) document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

// --- rendering ---------------------------------------------------------------------------------

function renderSignedIn() {
  const signedIn = Boolean(landlord);
  signInWrap.hidden = signedIn;
  board.hidden = !signedIn;
  signOutButton.hidden = !signedIn;
  nameLabel.hidden = !signedIn;
  nameLabel.textContent = signedIn ? t("landlord.signedInAs", { name: landlord.name }) : "";
}

// Slots keep whoever is still among the best (fillSlots), so acting on one card never moves the other.
function refillSlots() {
  const hidden = new Set([...overview.shortlist.map((entry) => entry.applicantId), ...skipped]);
  slots = fillSlots({ ranked: overview.ranked, current: slots, hidden });
}

function slotButton(className, key, label, index, busy, onClick) {
  const button = el("button", className, t(label));
  button.type = "button";
  button.dataset.focusKey = `slot:${index}:${key}`;
  button.disabled = busy;
  button.addEventListener("click", onClick);
  return button;
}

function renderSlots() {
  if (!overview) return slotList.replaceChildren();
  const byId = new Map(overview.ranked.map((entry) => [entry.applicantId, entry]));
  slotList.replaceChildren(
    ...slots.map((applicantId, index) => {
      if (!applicantId) return el("li", "lc-slot is-empty", t("landlordChat.slotEmpty"));
      const card = slotCard(byId.get(applicantId), { total: overview.ranked.length });
      const item = el("li", "lc-slot");
      item.dataset.applicantId = applicantId;

      const head = el("div", "lc-slot-head");
      const who = el("div", "lc-slot-who");
      const meta = el("p", "lc-slot-meta");
      meta.append(el("span", "", card.rankText));
      const badge = moveBadge(applicantId);
      if (badge) meta.append(badge);
      meta.append(el("span", "lc-slot-score", card.scoreText));
      who.append(el("h3", "lc-slot-name", card.name), meta);
      head.append(avatar(card.householdShape, 48), who);

      const busy = pending.has(applicantId);
      const actions = el("div", "lc-slot-actions");
      actions.append(
        slotButton("landlord-btn lc-add", "add", "landlordChat.addToShortlist", index, busy, () => addToShortlist(applicantId, item)),
        slotButton("landlord-link-btn", "skip", "landlordChat.skip", index, busy, () => skip(applicantId)),
        slotButton("landlord-link-btn", "ask", "landlordChat.ask", index, busy, () => toPrompt(t("landlordChat.askPrompt", { id: applicantId }))),
      );
      item.append(head, el("p", "lc-slot-reason", card.reason), actions);
      return item;
    }),
  );
}

function renderTiles() {
  const tiles = overview ? statTiles(overview.stats) : [];
  tileList.replaceChildren(
    ...tiles.map((tile) => {
      const item = el("li", `lc-tile${tile.available ? "" : " is-unavailable"}`);
      item.append(el("span", "lc-tile-value", tile.value), el("span", "lc-tile-label", tile.label));
      // Compact: the detail is a tooltip, and read out for screen readers.
      if (tile.detail) {
        item.title = tile.detail;
        item.append(el("span", "visually-hidden", tile.detail));
      }
      return item;
    }),
  );
  const count = overview?.poolErrors?.length ?? 0;
  poolErrors.hidden = count === 0;
  poolErrors.textContent = count ? t("landlord.ranking.poolErrors", { count }) : "";
}

function renderSidebar() {
  const rows = overview ? sidebarRows(overview.shortlist) : [];
  shortlistEmpty.hidden = !overview || rows.length > 0;
  shortlistList.replaceChildren(
    ...rows.map((row, index) => {
      const item = el("li", `lc-entry${row.excluded ? " is-excluded" : ""}`);
      item.dataset.applicantId = row.applicantId;
      const text = el("div", "lc-entry-text");
      const place = el("span", "lc-entry-place", row.placeText);
      const badge = row.excluded ? null : moveBadge(row.applicantId);
      if (badge) place.append(badge);
      text.append(el("span", "lc-entry-name", row.name), place, el("span", "lc-entry-status", row.statusText));

      const remove = el("button", "landlord-link-btn lc-entry-remove");
      remove.type = "button";
      remove.title = t("landlordChat.remove");
      remove.setAttribute("aria-label", row.removeLabel);
      remove.dataset.focusKey = `remove:${index}`;
      remove.disabled = pending.has(row.applicantId);
      const cross = el("span", "", "×");
      cross.setAttribute("aria-hidden", "true");
      remove.append(cross);
      remove.addEventListener("click", () => removeFromShortlist(row.applicantId, index));

      item.append(avatar(row.householdShape, 28), text, remove);
      return item;
    }),
  );
}

function renderBoard() {
  renderSlots();
  renderTiles();
  renderSidebar();
}

// --- tips --------------------------------------------------------------------------------------

function showTip() {
  const tip = tips[tipIndex];
  tipBox.hidden = !tip;
  if (!tip) return tipBody.replaceChildren();
  // A tip with an example is a button that puts it into the prompt; the others are plain text.
  const node = tip.example ? el("button", "lc-tip-text", tip.text) : el("span", "lc-tip-text", tip.text);
  if (tip.example) {
    node.type = "button";
    node.addEventListener("click", () => toPrompt(tip.example));
  }
  tipBody.replaceChildren(node);
}

function stopTips() {
  clearInterval(tipTimer);
  tipTimer = null;
}

// Redraws the tips from the overview. After a load the first ("heaviest") tip shows again; a
// language switch keeps the tip that was showing. Rotation pauses while the tip is hovered or focused.
function renderTips({ keepCurrent = false } = {}) {
  const currentId = tips[tipIndex]?.id;
  tips = overview ? landlordTips(overview) : [];
  const kept = keepCurrent ? tips.findIndex((tip) => tip.id === currentId) : -1;
  tipIndex = Math.max(kept, 0);
  const hadFocus = tipBox.contains(document.activeElement);
  showTip();
  if (hadFocus) tipBody.querySelector("button")?.focus();
  if (keepCurrent) return;
  stopTips();
  if (tips.length > 1) {
    tipTimer = setInterval(() => {
      if (tipHovered || tipFocused) return;
      tipIndex = (tipIndex + 1) % tips.length;
      showTip();
    }, TIP_INTERVAL_MS);
  }
}

tipBox.addEventListener("mouseenter", () => { tipHovered = true; });
tipBox.addEventListener("mouseleave", () => { tipHovered = false; });
tipBox.addEventListener("focusin", () => { tipFocused = true; });
tipBox.addEventListener("focusout", () => { tipFocused = false; });

// --- loading -----------------------------------------------------------------------------------

// Fetches the overview and redraws. `rankingChanged` (a turn changed the criteria or the flat
// details): the rank moves are measured against the ranking shown so far, and the skipped
// applicants come back into consideration. A response overtaken by a later request is dropped.
async function loadOverview({ rankingChanged = false } = {}) {
  if (!landlord) return;
  const landlordId = landlord.landlordId;
  const request = ++overviewRequest;
  let next;
  try {
    next = await fetchOverview({ fetchImpl: fetch, landlordId });
  } catch (error) {
    if (request === overviewRequest && landlord?.landlordId === landlordId) showError(boardError, error.message);
    return;
  }
  if (request !== overviewRequest || landlord?.landlordId !== landlordId) return;
  if (next.signedOut) return signOut();
  showError(boardError, null);
  if (rankingChanged) {
    moves = rankMoves(overview?.ranked, next.ranked);
    skipped = new Set();
  }
  overview = next;
  namesById = applicantNames(overview);
  refillSlots();
  renderBoard();
  renderTips();
}

// --- actions -----------------------------------------------------------------------------------

function skip(applicantId) {
  skipped.add(applicantId);
  const index = slots.indexOf(applicantId);
  refillSlots();
  renderSlots();
  // The next applicant's Skip in the same slot, or the heading when the slot is now empty.
  (slotList.querySelector(`[data-focus-key="slot:${index}:skip"]`) ?? $("#slots-title")).focus();
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// A snapshot of the slot card, fixed where the card was, so it can fly once the board is redrawn.
function snapshot(card) {
  if (reducedMotion() || !card.isConnected || typeof card.animate !== "function") return null;
  const from = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add("lc-flight");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { top: `${from.top}px`, left: `${from.left}px`, width: `${from.width}px`, height: `${from.height}px` });
  return { ghost, from };
}

// FLIP: the snapshot flies from the slot to the applicant's new Shortlist row, which appears when it lands.
function fly(flight, applicantId) {
  if (!flight) return;
  const target = shortlistList.querySelector(`[data-applicant-id="${CSS.escape(applicantId)}"]`);
  if (!target) return;
  const to = target.getBoundingClientRect();
  const { ghost, from } = flight;
  document.body.append(ghost);
  target.style.visibility = "hidden";
  const animation = ghost.animate(
    [
      { transform: "none", opacity: 1 },
      {
        transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
        opacity: 0.4,
      },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
  );
  const land = () => {
    ghost.remove();
    target.style.visibility = "";
  };
  animation.addEventListener("finish", land);
  animation.addEventListener("cancel", land);
}

// Runs one Shortlist change for `applicantId` and refetches the overview. The applicant stays
// pending (buttons disabled) until the board is redrawn from the refetch, so no redraw in between
// can re-enable a button for a change already sent. → true when saved; false when it failed (the
// error is shown in `errorNode`) or the landlord signed out.
async function changeShortlist(applicantId, errorNode, request) {
  if (!landlord || pending.has(applicantId)) return false;
  const landlordId = landlord.landlordId;
  pending.add(applicantId);
  renderSlots();
  renderSidebar();
  showError(errorNode, null);
  let result;
  try {
    result = await request({ fetchImpl: fetch, landlordId, applicantId });
  } catch (error) {
    result = { error: error.message };
  }
  try {
    if (landlord?.landlordId !== landlordId) return false;
    if (result.signedOut) {
      signOut();
      return false;
    }
    if (!result.entry) {
      const message = result.error ?? (result.notFound ? t("landlord.shortlist.notFound") : Object.values(result.problems ?? {}).join(" "));
      showError(errorNode, message || t("landlord.errors.failed"));
      return false;
    }
    await loadOverview();
    return true;
  } finally {
    pending.delete(applicantId);
    renderSlots();
    renderSidebar();
  }
}

async function addToShortlist(applicantId, card) {
  const index = slots.indexOf(applicantId);
  // Taken now: the redraw that disables the buttons replaces the card.
  const flight = snapshot(card);
  if (!(await changeShortlist(applicantId, boardError, (call) => saveShortlistEntry({ ...call, status: "to_invite" })))) return;
  fly(flight, applicantId);
  restoreFocus(`slot:${index}:add`);
}

async function removeFromShortlist(applicantId, index) {
  if (!(await changeShortlist(applicantId, shortlistError, (call) => removeShortlistEntry(call)))) return;
  // Keep the keyboard in the list: the remove button that took this one's place, or the heading.
  const buttons = shortlistList.querySelectorAll("button");
  const next = buttons[Math.min(index, buttons.length - 1)];
  const active = document.activeElement;
  if (!active || active === document.body) (next ?? $("#shortlist-title")).focus();
}

function clearChat() {
  chatMessages.replaceChildren(chatWelcome);
}

function signOut() {
  forgetLandlord(localStore());
  landlord = null;
  overview = null;
  overviewRequest += 1;
  namesById = new Map();
  slots = [null, null];
  skipped = new Set();
  moves = new Map();
  pending.clear();
  stopTips();
  tips = [];
  clearChat();
  showError(boardError, null);
  showError(shortlistError, null);
  renderSignedIn();
  renderBoard();
  showTip();
  signInName.focus();
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(signInError, null);
  try {
    landlord = await signIn({ fetchImpl: fetch, name: signInName.value });
  } catch (error) {
    showError(signInError, error.message);
    return;
  }
  rememberLandlord(localStore(), landlord);
  signInForm.reset();
  renderSignedIn();
  await loadOverview();
});

signOutButton.addEventListener("click", signOut);

// --- chat ----------------------------------------------------------------------------------------

// Follows the newest text while the landlord is reading at the bottom; leaves them alone when they
// scrolled up to reread an earlier turn. `following` is kept by the scroll events rather than
// measured at each render, so a layout change after the render (the tip under the prompt taking a
// second line shrinks the turns list) still ends at the last answer, not with it cut off.
let following = true;

function nearBottom() {
  return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 48;
}

// Scrolls to the end now and again in the next frame, once the rendered answer has its final height.
function stickToBottom() {
  if (!following) return;
  chatMessages.scrollTop = chatMessages.scrollHeight;
  requestAnimationFrame(() => {
    if (following) chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

chatMessages.addEventListener("scroll", () => {
  following = nearBottom();
});
new ResizeObserver(stickToBottom).observe(chatMessages);

function appendChatMessage(role, text) {
  const item = el("li", `landlord-chat-msg is-${role}`);
  item.setAttribute("aria-label", t(role === "user" ? "landlord.chat.you" : "landlord.chat.amtBuddy"));
  if (text !== undefined) item.textContent = text;
  chatMessages.append(item);
  if (role === "user") following = true;
  stickToBottom();
  return item;
}

// Draws the answer as it streams: markdown (escaped first by renderMarkdown) with the applicants'
// names next to their ids, escaped and added after rendering (renderAnswerWithNames), or the turn's error.
function drawTurn(item, state) {
  item.classList.toggle("is-pending", state.phase === "streaming" && !state.answer);
  item.classList.toggle("is-error", state.phase === "error");
  if (state.phase === "error" && !state.answer) item.textContent = state.error;
  else if (state.answer) item.innerHTML = renderAnswerWithNames(state.answer, namesById);
  stickToBottom();
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !landlord || streaming) return;
  const landlordId = landlord.landlordId;
  chatInput.value = "";
  appendChatMessage("user", message);
  const answer = appendChatMessage("answer", t("landlord.chat.thinking"));
  answer.classList.add("is-pending");
  // Only sending is blocked: the landlord may type the next message (or take a tip) meanwhile.
  streaming = true;
  chatSendButton.disabled = true;
  try {
    const state = await runLandlordTurn({ fetchImpl: fetch, landlordId, message, onChange: (next) => drawTurn(answer, next) });
    drawTurn(answer, state);
    if (landlord?.landlordId !== landlordId) return;
    if (state.signedOut) signOut();
    // A turn that changed the criteria, the Shortlist, the remembered preferences or the flat
    // details: refetch. Only criteria and flat details change the ranking itself.
    else if (changedDashboard(state)) await loadOverview({ rankingChanged: state.changed.criteria || state.changed.flat });
  } finally {
    streaming = false;
    chatSendButton.disabled = false;
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

onLanguageChange(() => {
  renderSignedIn();
  renderBoard();
  renderTips({ keepCurrent: true });
});

startI18n();
renderSignedIn();
if (landlord) loadOverview();

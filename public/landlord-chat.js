/**
 * Amt-Buddy /landlord-chat page, the chat-first prototype beside the classic /landlord dashboard:
 * two Recommendation slots and the pool at a glance on the left, the chat with the Landlord
 * Orchestrator in the middle (with a tip under the prompt that moves on with each turn), the
 * Shortlist with its status expanders on the right. Thumbs up/down on the slots and the Shortlist
 * are the landlord's own bonus on the ranking. The Selection criteria and the flat details change
 * through the chat only.
 *
 * The logic lives in ./landlord/ (server calls, the slots and sidebar, tips, avatars, rank moves,
 * the stored sign-in); this file only wires it to the DOM. Names and model answers are untrusted:
 * they go in as textContent, answers through renderAnswerWithNames (Markdown escaped first, names
 * escaped and added after rendering, never parsed). Only avatarSvg's code-generated markup goes
 * through innerHTML.
 */

import { fetchOverview, removeRating, removeShortlistEntry, saveRating, saveShortlistEntry, signIn } from "./landlord/api.js";
import { avatarSvg } from "./landlord/avatar.js";
import { fillSlots, sidebarRows, slotCard } from "./landlord/board.js";
import { applicantNames, changedDashboard, renderAnswerWithNames, runLandlordTurn } from "./landlord/chat.js";
import { statTiles } from "./landlord/pool-overview.js";
import { rankMoves } from "./landlord/rank-moves.js";
import { formatNumber } from "./landlord/ranking.js";
import { forgetLandlord, rememberLandlord, storedLandlord } from "./landlord/session.js";
import { statusOptions } from "./landlord/shortlist.js";
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
// Rank moves from the last chat turn that changed the ranking (criteria or flat details); shown
// until the next one, or until a rating moves ranks, since they no longer describe the latest change.
let moves = new Map();
// Applicants with a Shortlist or rating request running: their buttons stay disabled across
// redraws, so a double click cannot send the change twice.
const pending = new Set();
// Ratings shown before the server has them (applicant id → "up" | "down" | null), so a thumb
// colours at once. Dropped when the request ends: by then the refetched overview has the saved one.
const optimisticRatings = new Map();
// The Shortlist status expanders, kept across the redraws that replace the rows: which are open,
// the status and note typed but not saved yet, and a validation message per entry.
const openEditors = new Set();
const drafts = new Map();
const editorErrors = new Map();
let overviewRequest = 0;
let streaming = false;
let tips = [];
let tipIndex = 0;

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

const ratingOf = (applicantId, saved) => (optimisticRatings.has(applicantId) ? optimisticRatings.get(applicantId) : saved);

// A note belongs to "to invite" and "invited" only (as sidebarRows' noteAllowed, which is for the
// saved status); this is for the status picked in the expander but not saved yet.
const noteAllowedFor = (status) => status === "to_invite" || status === "invited";

// 👍 / 👎 for one applicant. The pressed thumb is the rating (saved, or just clicked); `onRate`
// gets the thumb and whether it was pressed, since clicking the pressed one takes the rating back.
// The group's title is the AGG hint.
function thumbs(rating, focusKey, busy, onRate) {
  const group = el("div", "lc-thumbs");
  group.setAttribute("role", "group");
  group.title = t("landlordChat.ratingHint");
  const points = formatNumber(overview.bonusPoints);
  for (const [value, symbol, key] of [["up", "👍", "landlordChat.thumbsUp"], ["down", "👎", "landlordChat.thumbsDown"]]) {
    const button = el("button", `lc-thumb is-${value}`);
    button.type = "button";
    const label = t(key, { points });
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(rating === value));
    button.dataset.focusKey = `${focusKey}:${value}`;
    button.disabled = busy;
    const icon = el("span", "", symbol);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    button.addEventListener("click", () => onRate(value, rating === value));
    group.append(button);
  }
  return group;
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
      const card = slotCard(byId.get(applicantId), { total: overview.ranked.length, move: moves.get(applicantId) });
      const item = el("li", "lc-slot");
      item.dataset.applicantId = applicantId;

      const head = el("div", "lc-slot-head");
      const who = el("div", "lc-slot-who");
      // "Match score 94.7 (↑1)": the move since the last ranking change, spoken as "moved up 1".
      const score = el("p", "lc-slot-score", card.scoreText);
      if (card.move) {
        const move = el("span", `lc-move is-${card.move.direction}`);
        const text = el("span", "", `(${card.move.text})`);
        text.setAttribute("aria-hidden", "true");
        move.append(text, el("span", "visually-hidden", card.move.label));
        score.append(" ", move);
      }
      who.append(el("h3", "lc-slot-name", card.name), score, el("p", "lc-slot-meta", card.rankText));
      if (card.bonusText) who.append(el("p", "lc-slot-bonus", card.bonusText));
      head.append(avatar(card.householdShape, 48), who);

      const busy = pending.has(applicantId);
      const actions = el("div", "lc-slot-actions");
      actions.append(
        slotButton("landlord-btn lc-add", "add", "landlordChat.addToShortlist", index, busy, () => addToShortlist(applicantId, item)),
        slotButton("landlord-link-btn", "skip", "landlordChat.skip", index, busy, () => skip(applicantId)),
        slotButton("landlord-link-btn", "ask", "landlordChat.ask", index, busy, () => toPrompt(t("landlordChat.askPrompt", { id: applicantId }))),
        thumbs(ratingOf(applicantId, card.rating), `slot:${index}`, busy, (value, pressed) => rate(applicantId, value, pressed, index)),
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

// The expander under a Shortlist entry: status, a note (for "to invite" and "invited" only), Save.
// What is typed survives the redraws until it is saved.
function statusEditor(row, busy) {
  const id = row.applicantId;
  const draft = drafts.get(id);
  const details = el("details", "lc-editor");
  details.open = openEditors.has(id);
  details.addEventListener("toggle", () => {
    if (details.open) openEditors.add(id);
    else openEditors.delete(id);
  });
  const summary = el("summary", "lc-editor-toggle", t("landlordChat.statusToggle"));
  summary.dataset.focusKey = `status:${id}`;

  const select = el("select");
  select.setAttribute("aria-label", `${t("landlord.shortlist.statusLabel")}: ${row.name}`);
  for (const { value, label } of statusOptions()) {
    const option = el("option", "", label);
    option.value = value;
    option.selected = value === (draft?.status ?? row.status);
    select.append(option);
  }
  const statusField = el("label", "lc-editor-field");
  statusField.append(el("span", "", t("landlord.shortlist.statusLabel")), select);

  const note = el("input");
  note.maxLength = 500;
  note.value = draft?.note ?? row.note ?? "";
  note.placeholder = t("landlord.shortlist.notePlaceholder");
  note.setAttribute("aria-label", `${t("landlordChat.noteLabel")}: ${row.name}`);
  const noteField = el("label", "lc-editor-field");
  noteField.append(el("span", "", t("landlordChat.noteLabel")), note);
  noteField.hidden = !(draft ? noteAllowedFor(draft.status) : row.noteAllowed);

  const remember = () => drafts.set(id, { status: select.value, note: note.value });
  select.addEventListener("change", () => {
    remember();
    noteField.hidden = !noteAllowedFor(select.value);
  });
  note.addEventListener("input", remember);

  const error = el("p", "landlord-error lc-editor-error");
  error.setAttribute("role", "alert");
  showError(error, editorErrors.get(id));
  const save = el("button", "landlord-btn lc-editor-save", t("landlordChat.saveStatus"));
  save.type = "submit";
  save.dataset.focusKey = `save:${id}`;
  save.disabled = busy;

  const form = el("form", "lc-editor-form");
  form.noValidate = true;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const status = select.value;
    saveStatus(id, status, noteAllowedFor(status) ? note.value : null);
  });
  form.append(statusField, noteField, error, save);
  details.append(summary, form);
  return details;
}

function renderSidebar() {
  const rows = overview ? sidebarRows(overview.shortlist) : [];
  shortlistEmpty.hidden = !overview || rows.length > 0;
  shortlistList.replaceChildren(
    ...rows.map((row, index) => {
      const item = el("li", `lc-entry${row.excluded ? " is-excluded" : ""}`);
      item.dataset.applicantId = row.applicantId;
      const busy = pending.has(row.applicantId);
      const text = el("div", "lc-entry-text");
      text.append(
        el("span", "lc-entry-name", row.name),
        el("span", "lc-entry-place", row.placeText),
        el("span", "lc-entry-status", row.statusText),
      );

      const remove = el("button", "landlord-link-btn lc-entry-remove");
      remove.type = "button";
      remove.title = t("landlordChat.remove");
      remove.setAttribute("aria-label", row.removeLabel);
      remove.dataset.focusKey = `remove:${index}`;
      remove.disabled = busy;
      const cross = el("span", "", "×");
      cross.setAttribute("aria-hidden", "true");
      remove.append(cross);
      remove.addEventListener("click", () => removeFromShortlist(row.applicantId, index));

      const rating = thumbs(ratingOf(row.applicantId, row.rating), `rate:${row.applicantId}`, busy, (value, pressed) =>
        rate(row.applicantId, value, pressed),
      );
      item.append(avatar(row.householdShape, 28), text, remove, rating, statusEditor(row, busy));
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
  const hadFocus = tipBox.contains(document.activeElement);
  // A tip with an example is a button that puts it into the prompt; the others are plain text.
  const node = tip.example ? el("button", "lc-tip-text", tip.text) : el("span", "lc-tip-text", tip.text);
  if (tip.example) {
    node.type = "button";
    node.addEventListener("click", () => toPrompt(tip.example));
  }
  tipBody.replaceChildren(node);
  if (hadFocus) tipBody.querySelector("button")?.focus();
}

// Redraws the tips from the overview (its bonusPoints feed the thumbs tip). After a sign-in or a
// page load (`first`) the first ("heaviest") tip shows; any other refetch, and a language switch,
// keep the tip that was showing, or the one now in its place when it no longer applies. Only a
// finished chat turn moves on to the next tip (nextTip).
function renderTips({ first = false } = {}) {
  const currentId = tips[tipIndex]?.id;
  tips = overview ? landlordTips(overview) : [];
  const kept = first ? 0 : tips.findIndex((tip) => tip.id === currentId);
  tipIndex = kept >= 0 ? kept : Math.min(tipIndex, Math.max(tips.length - 1, 0));
  showTip();
}

function nextTip() {
  if (tips.length === 0) return;
  tipIndex = (tipIndex + 1) % tips.length;
  showTip();
}

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
  const first = !overview;
  if (rankingChanged) {
    moves = rankMoves(overview?.ranked, next.ranked);
    skipped = new Set();
  }
  overview = next;
  namesById = applicantNames(overview);
  refillSlots();
  renderBoard();
  renderTips({ first });
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

// The server's validation messages are English: only a too-long note can come from this page.
const problemText = (problems) => (problems.note ? t("landlord.shortlist.noteTooLong") : t("landlord.errors.failed"));

// Runs one Shortlist change for `applicantId` and refetches the overview. The applicant stays
// pending (buttons disabled) until the board is redrawn from the refetch, so no redraw in between
// can re-enable a button for a change already sent. → true when saved; false when it failed (the
// error is shown in `errorNode`, validation problems through `onProblems` when given) or the
// landlord signed out.
async function changeShortlist(applicantId, errorNode, request, onProblems) {
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
      if (result.problems && onProblems) {
        onProblems(problemText(result.problems));
        return false;
      }
      const message = result.error ?? (result.notFound ? t("landlord.shortlist.notFound") : result.problems && problemText(result.problems));
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

// Saves the status (and note, null where the status has none) from an entry's expander; the
// expander closes on success, so the row shows the saved status.
async function saveStatus(applicantId, status, note) {
  editorErrors.delete(applicantId);
  const saved = await changeShortlist(
    applicantId,
    shortlistError,
    (call) => saveShortlistEntry({ ...call, status, note }),
    (message) => editorErrors.set(applicantId, message),
  );
  if (!saved) return restoreFocus(`save:${applicantId}`);
  drafts.delete(applicantId);
  openEditors.delete(applicantId);
  renderSidebar();
  restoreFocus(`status:${applicantId}`);
}

// A thumb click: rates the applicant `value`, or takes the rating back when that thumb was
// `pressed`. The thumb colours at once and the overview is refetched, since the bonus moves the
// ranking; on a failure the thumb is put back. Thumbs down on a slot (`slotIndex`) also skips the
// applicant, so the card is replaced at once like Skip; they can come back after the next ranking
// change through the chat, then with the red thumb.
async function rate(applicantId, value, pressed, slotIndex = null) {
  if (!landlord || pending.has(applicantId)) return;
  const landlordId = landlord.landlordId;
  const next = pressed ? null : value;
  const inSlot = slotIndex !== null;
  const errorNode = inSlot ? boardError : shortlistError;
  const skipsCard = inSlot && next === "down" && !skipped.has(applicantId);
  // Where the keyboard goes back to: this thumb, or, when the card is gone, the next card's Skip.
  const focusKey = skipsCard ? `slot:${slotIndex}:skip` : inSlot ? `slot:${slotIndex}:${value}` : `rate:${applicantId}:${value}`;
  const slotsBefore = slots;
  pending.add(applicantId);
  optimisticRatings.set(applicantId, next);
  if (skipsCard) {
    skipped.add(applicantId);
    refillSlots();
  }
  renderSlots();
  renderSidebar();
  if (skipsCard) (slotList.querySelector(`[data-focus-key="${focusKey}"]`) ?? $("#slots-title")).focus();
  showError(errorNode, null);
  let result;
  try {
    result = next
      ? await saveRating({ fetchImpl: fetch, landlordId, applicantId, rating: next })
      : await removeRating({ fetchImpl: fetch, landlordId, applicantId });
  } catch (error) {
    result = { error: error.message };
  }
  try {
    if (landlord?.landlordId !== landlordId) return;
    if (result.signedOut) return signOut();
    if (result.rating === undefined) {
      if (skipsCard) {
        skipped.delete(applicantId);
        slots = slotsBefore;
        refillSlots();
      }
      showError(errorNode, result.error ?? t(result.notFound ? "landlord.shortlist.notFound" : "landlord.errors.failed"));
      return;
    }
    moves = new Map();
    await loadOverview();
  } finally {
    pending.delete(applicantId);
    optimisticRatings.delete(applicantId);
    renderSlots();
    renderSidebar();
    restoreFocus(focusKey);
  }
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
  optimisticRatings.clear();
  openEditors.clear();
  drafts.clear();
  editorErrors.clear();
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
    if (state.signedOut) return signOut();
    // A turn that changed the criteria, the Shortlist, the remembered preferences or the flat
    // details: refetch. Only criteria and flat details change the ranking itself.
    if (changedDashboard(state)) await loadOverview({ rankingChanged: state.changed.criteria || state.changed.flat });
    // One tip per finished turn: the next one shows as the answer ends.
    nextTip();
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
  renderTips();
});

startI18n();
renderSignedIn();
if (landlord) loadOverview();

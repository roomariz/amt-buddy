/**
 * Amt-Buddy /landlord page: sign in with a name, enter the Listing, see its Rent check and the
 * pool stats, the Recommendations, the Shortlist and the ranked applicants, and chat with the
 * Landlord Orchestrator.
 *
 * The logic lives in ./landlord/ (server calls, the form and range-bar view model, the ranking
 * table, the stored sign-in); this file only wires it to the DOM. Server text is always set as textContent.
 */

import { fetchDashboard, removeShortlistEntry, saveListing, saveShortlistEntry, signIn } from "./landlord/api.js";
import { runLandlordTurn } from "./landlord/chat.js";
import { renderMarkdown } from "./chat/markdown.js";
import { listingFormValues, listingRequest, rentCheckView } from "./landlord/listing.js";
import { breakdownBars, documentFlags, exclusionText, formatMoney, formatNumber, formatPercent, rankingRows } from "./landlord/ranking.js";
import { poolSummary, recommendationCards, recommendationsEmptyText, statTiles } from "./landlord/pool-overview.js";
import { forgetLandlord, rememberLandlord, storedLandlord } from "./landlord/session.js";
import { applyShortlistChange, isShortlisted, shortlistRows, statusOptions } from "./landlord/shortlist.js";
import { onLanguageChange, startI18n, t } from "./i18n.js";

const $ = (selector) => document.querySelector(selector);

const signInSection = $("#sign-in");
const signInForm = $("#sign-in-form");
const signInName = $("#sign-in-name");
const signInError = $("#sign-in-error");
const listingSection = $("#listing");
const listingForm = $("#listing-form");
const listingError = $("#listing-error");
const saveButton = $("#btn-save-listing");
const rentCheckSection = $("#rent-check");
const rentCheckBody = $("#rent-check-body");
const nameLabel = $("#landlord-name");
const signOutButton = $("#btn-sign-out");
const chatSection = $("#landlord-chat");
const chatMessages = $("#landlord-chat-messages");
const chatForm = $("#landlord-chat-form");
const chatInput = $("#landlord-chat-input");
const chatSendButton = $("#btn-landlord-chat-send");
const rankingSection = $("#ranking");
const rankingHint = $("#ranking-hint");
const rankingBody = $("#ranking-body");
const rankingSort = $("#ranking-sort");
const rankingCompleteOnly = $("#ranking-complete-only");
const rankingCount = $("#ranking-count");
const rankingRowsBody = $("#ranking-rows");
const rankingEmpty = $("#ranking-empty");
const rankingPoolErrors = $("#ranking-pool-errors");
const excludedBlock = $("#excluded");
const excludedList = $("#excluded-list");
const poolOverviewSection = $("#pool-overview");
const poolOverviewSummary = $("#pool-overview-summary");
const poolOverviewTiles = $("#pool-overview-tiles");
const recommendationList = $("#recommendation-cards");
const recommendationsEmpty = $("#recommendations-empty");
const shortlistSection = $("#shortlist");
const shortlistError = $("#shortlist-error");
const shortlistList = $("#shortlist-list");
const shortlistEmpty = $("#shortlist-empty");

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let landlord = storedLandlord(localStore());
let listing = null;
let ranking = null; // { ranked, excluded, hint, poolErrors } from the dashboard
let poolOverview = null; // { stats, recommendations } from the dashboard; stats is null without a Listing
let shortlist = []; // the Shortlist from the dashboard

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

// --- rendering ---------------------------------------------------------------------------------

function renderSignedIn() {
  const signedIn = Boolean(landlord);
  signInSection.hidden = signedIn;
  listingSection.hidden = !signedIn;
  chatSection.hidden = !signedIn;
  signOutButton.hidden = !signedIn;
  nameLabel.hidden = !signedIn;
  nameLabel.textContent = signedIn ? t("landlord.signedInAs", { name: landlord.name }) : "";
  if (!signedIn) {
    rentCheckSection.hidden = true;
    rankingSection.hidden = true;
    poolOverviewSection.hidden = true;
    shortlistSection.hidden = true;
  }
}

function fillForm(values) {
  for (const [field, value] of Object.entries(values)) listingForm.elements[field].value = value;
}

function showFieldProblems(problems = {}) {
  for (const node of listingForm.querySelectorAll("[data-error-for]")) {
    const message = problems[node.dataset.errorFor];
    node.textContent = message ?? "";
    node.hidden = !message;
    listingForm.elements[node.dataset.errorFor]?.setAttribute("aria-invalid", String(Boolean(message)));
  }
}

function fact(list, label, value) {
  const row = el("div", "landlord-fact");
  row.append(el("dt", "", label), el("dd", "", value ?? t("landlord.unknown")));
  list.append(row);
}

function rangeBar(view, rentCheck) {
  const bar = el("div", "rent-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute(
    "aria-label",
    `${t("landlord.rangeLabel")}: ${formatMoney(rentCheck.range.lower)} – ${formatMoney(rentCheck.range.upper)}; ${t("landlord.askingMark")}: ${formatMoney(rentCheck.askingRent)}`,
  );
  const band = el("div", "rent-bar-range");
  band.style.left = `${view.lowerPercent}%`;
  band.style.width = `${view.upperPercent - view.lowerPercent}%`;
  bar.append(band);
  const mark = (className, percent, label) => {
    const node = el("div", `rent-bar-mark ${className}`);
    node.style.left = `${percent}%`;
    node.append(el("span", "rent-bar-label", label));
    bar.append(node);
  };
  mark("is-median", view.medianPercent, t("landlord.median"));
  mark("is-allowed", view.allowedPercent, t("landlord.allowedMark"));
  mark(`is-asking is-${view.position}`, view.askingPercent, t("landlord.askingMark"));
  return bar;
}

function renderRentCheck() {
  rentCheckBody.replaceChildren();
  rentCheckSection.hidden = !listing;
  if (!listing) return;

  const facts = el("dl", "landlord-facts");
  const address = listing.canonicalAddress;
  fact(facts, t("landlord.officialAddress"), address ? `${address.street} ${address.houseNumber}, ${address.postalCode} ${address.city ?? "Berlin"}` : null);
  fact(facts, t("landlord.residentialLocation"), listing.residentialLocation);
  fact(facts, t("landlord.buildingAgePeriod"), listing.buildingAgePeriod);
  if (listing.buildingYear) fact(facts, t("landlord.buildingYearUsed"), String(listing.buildingYear));
  rentCheckBody.append(facts);

  if (listing.note) {
    const key = `landlord.notes.${listing.note.code}`;
    const text = t(key);
    rentCheckBody.append(el("p", "landlord-note", text === key ? listing.note.message : text));
  }

  const rentCheck = listing.rentCheck;
  if (!rentCheck) return;
  const view = rentCheckView(rentCheck);
  rentCheckBody.append(el("h3", "rent-check-subtitle", t("landlord.rangeLabel")), rangeBar(view, rentCheck));

  const range = el("dl", "rent-range");
  for (const bound of ["lower", "median", "upper"]) {
    const item = el("div", "rent-range-item");
    item.append(el("dt", "", t(`landlord.${bound}`)), el("dd", "", formatMoney(rentCheck.range[bound])));
    range.append(item);
  }
  rentCheckBody.append(range);

  rentCheckBody.append(
    el("p", `rent-position is-${view.position}`, t(`landlord.position.${view.position}`, { rent: formatMoney(rentCheck.askingRent) })),
  );
  if (view.warning) {
    const warning = el(
      "p",
      "rent-warning",
      t("landlord.warning", { excess: formatMoney(view.warning.excess), allowed: formatMoney(view.warning.allowedRent) }),
    );
    warning.setAttribute("role", "alert");
    rentCheckBody.append(warning);
  } else {
    rentCheckBody.append(el("p", "rent-within-cap", t("landlord.withinCap", { allowed: formatMoney(rentCheck.allowedRent) })));
  }
}

// --- the pool overview: pool stats and Recommendations ----------------------------------------

function renderPoolOverview() {
  poolOverviewSection.hidden = !poolOverview?.stats;
  if (!poolOverview?.stats) return;
  poolOverviewSummary.textContent = poolSummary(poolOverview.stats);
  poolOverviewTiles.replaceChildren(
    ...statTiles(poolOverview.stats).map((tile) => {
      const item = el("li", `pool-tile${tile.available ? "" : " is-unavailable"}`);
      item.append(el("span", "pool-tile-value", tile.value), el("span", "pool-tile-label", tile.label));
      if (tile.detail) item.append(el("span", "pool-tile-detail", tile.detail));
      return item;
    }),
  );
  const cards = recommendationCards(poolOverview.recommendations);
  recommendationList.replaceChildren(
    ...cards.map((card) => {
      const item = el("li", "recommendation-card");
      const head = el("div", "recommendation-head");
      head.append(
        el("span", "recommendation-name", card.name),
        el("span", "recommendation-score", t("landlord.poolOverview.score", { score: card.matchScore })),
      );
      item.append(
        head,
        el("span", "recommendation-rank", t("landlord.poolOverview.rank", { rank: card.rank })),
        el("p", "recommendation-reason", card.reason),
        shortlistButton(card.applicantId, "recommendation"),
      );
      return item;
    }),
  );
  const emptyText = recommendationsEmptyText(poolOverview.stats, poolOverview.recommendations);
  recommendationsEmpty.hidden = !emptyText;
  recommendationsEmpty.textContent = emptyText ?? "";
}

// --- the Shortlist -------------------------------------------------------------------------------

// Redraws with `render` and gives the focus back to the control that had it (same data-focus-key),
// so saving from the keyboard does not drop the focus to the page.
function keepingFocus(render) {
  const key = document.activeElement?.dataset?.focusKey;
  render();
  if (key) document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

function redrawShortlistAndButtons() {
  keepingFocus(() => {
    renderShortlist();
    renderPoolOverview();
    renderRanking();
  });
}

// Shortlist changes run one after another, in the order the landlord made them, so a note saved
// on blur and a Remove clicked right after cannot reach the server the other way round.
let shortlistQueue = Promise.resolve();

// Sends one Shortlist change and applies the server's answer to the page's Shortlist; the rest of
// the dashboard (and the Listing form with any unsaved edits) is left alone.
function changeShortlist(request) {
  shortlistQueue = shortlistQueue.then(async () => {
    if (!landlord) return;
    showError(shortlistError, null);
    let result;
    try {
      result = await request({ fetchImpl: fetch, landlordId: landlord.landlordId });
    } catch (error) {
      result = { error: error.message };
    }
    if (result.signedOut) {
      signOut();
      return;
    }
    if (!result.entry) {
      const message = result.error ?? (result.notFound ? t("landlord.shortlist.notFound") : Object.values(result.problems).join(" "));
      showError(shortlistError, message);
      // Put the controls back to what is saved.
      keepingFocus(renderShortlist);
      return;
    }
    const wasListed = isShortlisted(shortlist, result.entry.applicantId);
    shortlist = applyShortlistChange(shortlist, result.entry, ranking);
    // A status or note change is already on screen; only adding or removing redraws.
    if (wasListed !== isShortlisted(shortlist, result.entry.applicantId)) redrawShortlistAndButtons();
    else shortlistList.querySelector(`[data-applicant-id="${CSS.escape(result.entry.applicantId)}"]`)?.setAttribute("class", `shortlist-entry is-${result.entry.status}`);
  });
  return shortlistQueue;
}

// "Add to Shortlist" for the ranking and the Recommendation cards (`place`); "On the Shortlist"
// once added.
function shortlistButton(applicantId, place) {
  const added = isShortlisted(shortlist, applicantId);
  const button = el("button", "landlord-link-btn shortlist-add", t(added ? "landlord.shortlist.added" : "landlord.shortlist.add"));
  button.type = "button";
  button.disabled = added;
  button.dataset.focusKey = `add:${place}:${applicantId}`;
  button.addEventListener("click", () =>
    changeShortlist((call) => saveShortlistEntry({ ...call, applicantId, status: "to_invite" })),
  );
  return button;
}

function renderShortlist() {
  shortlistSection.hidden = !ranking;
  if (!ranking) return;
  const rows = shortlistRows(shortlist);
  shortlistEmpty.hidden = rows.length > 0;
  shortlistList.replaceChildren(
    ...rows.map((row) => {
      const item = el("li", `shortlist-entry is-${row.status}`);
      item.dataset.applicantId = row.applicantId;
      const head = el("div", "shortlist-head");
      head.append(el("span", "shortlist-name", row.name), el("span", "shortlist-score", row.score));

      const status = el("select", "shortlist-status");
      status.dataset.focusKey = `status:${row.applicantId}`;
      status.setAttribute("aria-label", `${t("landlord.shortlist.statusLabel")}: ${row.name}`);
      for (const { value, label } of statusOptions()) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === row.status;
        status.append(option);
      }
      status.addEventListener("change", () =>
        changeShortlist((call) => saveShortlistEntry({ ...call, applicantId: row.applicantId, status: status.value })),
      );

      const note = el("input", "shortlist-note");
      note.dataset.focusKey = `note:${row.applicantId}`;
      note.value = row.note;
      note.maxLength = 500;
      note.placeholder = t("landlord.shortlist.notePlaceholder");
      note.setAttribute("aria-label", `${t("landlord.shortlist.noteLabel")}: ${row.name}`);
      note.addEventListener("change", () =>
        changeShortlist((call) => saveShortlistEntry({ ...call, applicantId: row.applicantId, status: status.value, note: note.value })),
      );

      const remove = el("button", "landlord-link-btn shortlist-remove", t("landlord.shortlist.remove"));
      remove.type = "button";
      remove.addEventListener("click", () => changeShortlist((call) => removeShortlistEntry({ ...call, applicantId: row.applicantId })));

      const controls = el("div", "shortlist-controls");
      controls.append(status, note, remove);
      item.append(head, controls);
      return item;
    }),
  );
}

// --- the ranked applicants -----------------------------------------------------------------------

function breakdownCell(entry) {
  const bars = el("div", "ranking-bars");
  for (const bar of breakdownBars(entry)) {
    const label = t("landlord.ranking.bar", {
      criterion: t(`landlord.ranking.criteria.${bar.criterion}`),
      percent: bar.percent,
      weight: bar.weight,
    });
    const node = el("div", "ranking-bar");
    node.title = label;
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", label);
    const fill = el("div", "ranking-bar-fill");
    fill.style.height = `${bar.percent}%`;
    node.append(fill);
    bars.append(node);
  }
  return bars;
}

function flagsCell(documents) {
  const flags = el("div", "ranking-flags");
  for (const flag of documentFlags(documents)) {
    const text = `${t(`landlord.ranking.document.${flag.document}`)}: ${t(`landlord.ranking.documentStatus.${flag.status}`)}`;
    flags.append(el("span", `ranking-flag${flag.ok ? "" : " is-problem"}`, text));
  }
  return flags;
}

function renderRanking() {
  rankingSection.hidden = !ranking;
  if (!ranking) return;
  rankingHint.hidden = !ranking.hint;
  if (ranking.hint) rankingHint.textContent = t("landlord.ranking.hint");
  rankingPoolErrors.hidden = ranking.poolErrors.length === 0;
  rankingPoolErrors.textContent = t("landlord.ranking.poolErrors", { count: ranking.poolErrors.length });
  rankingBody.hidden = Boolean(ranking.hint);
  if (ranking.hint) return;

  rankingCount.textContent = t("landlord.ranking.count", { ranked: ranking.ranked.length, excluded: ranking.excluded.length });
  const rows = rankingRows(ranking.ranked, { sort: rankingSort.value, completeOnly: rankingCompleteOnly.checked });
  rankingRowsBody.replaceChildren(
    ...rows.map((entry) => {
      const row = el("tr");
      const cell = (content, className) => {
        const td = el("td", className);
        if (content instanceof Node) td.append(content);
        else td.textContent = content;
        row.append(td);
      };
      cell(String(entry.rank));
      cell(entry.name);
      cell(formatNumber(entry.matchScore), "ranking-score");
      cell(breakdownCell(entry));
      cell(formatPercent(entry.rentToIncome));
      cell(flagsCell(entry.documents));
      cell(shortlistButton(entry.applicantId, "ranking"));
      return row;
    }),
  );
  rankingEmpty.hidden = rows.length > 0;

  excludedBlock.hidden = ranking.excluded.length === 0;
  excludedList.replaceChildren(
    ...ranking.excluded.map((entry) => {
      const item = el("li");
      item.append(el("span", "excluded-name", entry.name), el("span", "", entry.reasons.map(exclusionText).join(" ")));
      return item;
    }),
  );
}

rankingSort.addEventListener("change", renderRanking);
rankingCompleteOnly.addEventListener("change", renderRanking);

// --- actions -----------------------------------------------------------------------------------

function signOut() {
  forgetLandlord(localStore());
  landlord = null;
  listing = null;
  ranking = null;
  poolOverview = null;
  shortlist = [];
  fillForm(listingFormValues(null));
  chatMessages.replaceChildren();
  showFieldProblems();
  showError(listingError, null);
  renderSignedIn();
  renderRentCheck();
  renderPoolOverview();
  renderShortlist();
  renderRanking();
  signInName.focus();
}

async function loadDashboard() {
  try {
    const dashboard = await fetchDashboard({ fetchImpl: fetch, landlordId: landlord.landlordId });
    if (dashboard.signedOut) {
      signOut();
      return;
    }
    listing = dashboard.listing;
    const { ranked, excluded, hint, poolErrors, stats, recommendations } = dashboard;
    ranking = { ranked, excluded, hint, poolErrors };
    poolOverview = { stats, recommendations };
    shortlist = dashboard.shortlist;
    fillForm(listingFormValues(listing));
    renderRentCheck();
    renderPoolOverview();
    renderShortlist();
    renderRanking();
  } catch (error) {
    showError(listingError, error.message);
  }
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
  await loadDashboard();
});

listingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(listingError, null);
  showFieldProblems();
  const values = Object.fromEntries(new FormData(listingForm));
  saveButton.disabled = true;
  saveButton.textContent = t("landlord.saving");
  try {
    const result = await saveListing({ fetchImpl: fetch, landlordId: landlord.landlordId, request: listingRequest(values) });
    if (result.signedOut) signOut();
    else if (result.problems) showFieldProblems(result.problems);
    else {
      listing = result.listing;
      renderRentCheck();
      // The ranking depends on the rent and the size: fetch it again.
      await loadDashboard();
    }
  } catch (error) {
    showError(listingError, error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = t("landlord.save");
  }
});

// --- chat ----------------------------------------------------------------------------------------

function appendChatMessage(role, text) {
  const item = el("li", `landlord-chat-msg is-${role}`);
  item.setAttribute("aria-label", t(role === "user" ? "landlord.chat.you" : "landlord.chat.amtBuddy"));
  if (text !== undefined) item.textContent = text;
  chatMessages.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

// Draws the answer as it streams: markdown (escaped first by renderMarkdown), or the turn's error.
function drawTurn(item, state) {
  item.classList.toggle("is-pending", state.phase === "streaming" && !state.answer);
  item.classList.toggle("is-error", state.phase === "error");
  if (state.phase === "error" && !state.answer) item.textContent = state.error;
  else if (state.answer) item.innerHTML = renderMarkdown(state.answer);
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !landlord) return;
  chatInput.value = "";
  appendChatMessage("user", message);
  const answer = appendChatMessage("answer", t("landlord.chat.thinking"));
  answer.classList.add("is-pending");
  chatInput.disabled = true;
  chatSendButton.disabled = true;
  try {
    const state = await runLandlordTurn({
      fetchImpl: fetch,
      landlordId: landlord.landlordId,
      message,
      onChange: (next) => drawTurn(answer, next),
    });
    drawTurn(answer, state);
    if (state.signedOut) signOut();
    // After every turn the dashboard is fetched again, so it shows what the chat changed.
    else if (state.phase === "done") await loadDashboard();
  } finally {
    chatInput.disabled = false;
    chatSendButton.disabled = false;
    if (landlord) chatInput.focus();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

signOutButton.addEventListener("click", signOut);

onLanguageChange(() => {
  renderSignedIn();
  renderRentCheck();
  renderPoolOverview();
  renderShortlist();
  renderRanking();
});

startI18n();
renderSignedIn();
if (landlord) loadDashboard();

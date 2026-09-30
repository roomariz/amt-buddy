/**
 * Amt-Buddy /landlord page: sign in with a name, enter the Listing, see its Rent check and the
 * pool stats, the Recommendations, the Shortlist and the ranked applicants, and chat with the
 * Landlord Orchestrator, which remembers the landlord's preferences (listed here, each deletable).
 *
 * The logic lives in ./landlord/ (server calls, the form and range-bar view model, the ranking
 * table, the stored sign-in); this file only wires it to the DOM. Server text is always set as textContent.
 */

import { deleteNote, requestClarification, fetchApplicantProfile, fetchDashboard, removeShortlistEntry, saveCriteria, saveListing, saveShortlistEntry, signIn } from "./landlord/api.js";
import { applicantDetailView } from "./landlord/applicant-detail.js";
import { criteriaFormValues, criteriaRequest, WEIGHT_FIELDS } from "./landlord/criteria.js";
import { changedDashboard, runLandlordTurn, splitAnswer } from "./landlord/chat.js";
import { renderMarkdown } from "./chat/markdown.js";
import { listingFormValues, listingRequest, rentCheckView } from "./landlord/listing.js";
import { breakdownBars, documentFlags, exclusionText, formatMoney, formatNumber, formatPercent, rankingRows } from "./landlord/ranking.js";
import { poolSummary, recommendationCards, recommendationsEmptyText, statTiles } from "./landlord/pool-overview.js";
import { preferenceRows, withoutNote } from "./landlord/preferences.js";
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
const preferencesSection = $("#preferences");
const preferencesError = $("#preferences-error");
const preferencesList = $("#preferences-list");
const preferencesEmpty = $("#preferences-empty");
const criteriaSection = $("#selection-criteria");
const criteriaForm = $("#criteria-form");
const criteriaControls = $("#criteria-controls");
const criteriaError = $("#criteria-error");
const criteriaStatus = $("#criteria-status");
const resetCriteriaButton = $("#btn-reset-criteria");
const applicantDetailSection = $("#applicant-detail");
const applicantDetailTitle = $("#applicant-detail-title");
const applicantDetailStatus = $("#applicant-detail-status");
const applicantDetailBody = $("#applicant-detail-body");
const applicantDetailClose = $("#applicant-detail-close");
const landlordTabs = $("#landlord-tabs");
const tabShortlistCount = $("#tab-shortlist-count");

let currentTab = "chat";

function updateTabVisibility() {
  const signedIn = Boolean(landlord);
  if (landlordTabs) landlordTabs.hidden = !signedIn;
  if (!signedIn) {
    signInSection.hidden = false;
    listingSection.hidden = true;
    rentCheckSection.hidden = true;
    criteriaSection.hidden = true;
    shortlistSection.hidden = true;
    poolOverviewSection.hidden = true;
    rankingSection.hidden = true;
    applicantDetailSection.hidden = true;
    preferencesSection.hidden = true;
    chatSection.hidden = true;
    return;
  }
  signInSection.hidden = true;

  for (const btn of document.querySelectorAll(".landlord-tab-btn")) {
    const isActive = btn.dataset.tab === currentTab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  }

  listingSection.hidden = currentTab !== "flat";
  rentCheckSection.hidden = currentTab !== "flat" || !listing;

  criteriaSection.hidden = currentTab !== "criteria";

  shortlistSection.hidden = currentTab !== "shortlist" || !ranking;

  poolOverviewSection.hidden = currentTab !== "ranking" || !poolOverview?.stats;
  rankingSection.hidden = currentTab !== "ranking" || !ranking;
  applicantDetailSection.hidden = currentTab !== "ranking" || !selectedApplicantId;

  preferencesSection.hidden = currentTab !== "preferences" || notes === null;

  chatSection.hidden = currentTab !== "chat";
}

function selectTab(tab) {
  currentTab = tab;
  updateTabVisibility();
}

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
let notes = null; // the remembered Landlord preferences from the dashboard; null until it is loaded
let defaultCriteria = null;
let criteriaStatusKey = null;
let criteriaErrorKey = null;
let selectedApplicantId = null;
let applicantDetail = null;
let applicantDetailError = null;
let detailRequest = 0;
let detailOpener = null;
let clarificationBusy = false;
let clarificationError = null;

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
  signOutButton.hidden = !signedIn;
  nameLabel.hidden = !signedIn;
  nameLabel.textContent = signedIn ? t("landlord.signedInAs", { name: landlord.name }) : "";
  const navChat = document.querySelector('a.landlord-nav-link[href^="/landlord-chat.html"]');
  if (navChat) {
    navChat.href = signedIn ? `/landlord-chat.html?name=${encodeURIComponent(landlord.name)}` : "/landlord-chat.html";
  }
  updateTabVisibility();
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

function fact(list, label, value, detail) {
  const row = el("div", "landlord-fact");
  row.append(el("dt", "", label), el("dd", "", value ?? t("landlord.unknown")));
  if (detail) row.append(el("p", "landlord-fact-detail", detail));
  list.append(row);
}

// Where the building age class comes from: the landlord's year, the block's period or its most common decade.
function buildingAgeDetail(listing) {
  const age = listing.buildingAge;
  if (!age) return listing.buildingAgePeriod;
  return t(`landlord.buildingAgeSource.${age.source}`, {
    year: listing.buildingYear,
    period: listing.buildingAgePeriod,
    decade: age.decade,
  });
}

function openButton(applicantId, name) {
  const button = el("button", "applicant-open", name);
  button.type = "button";
  button.setAttribute("aria-label", t("landlord.detail.open", { name }));
  button.addEventListener("click", () => openApplicant(applicantId, button));
  return button;
}

function closeApplicantDetail() {
  detailRequest += 1;
  selectedApplicantId = null;
  applicantDetail = null;
  applicantDetailError = null;
  clarificationBusy = false;
  clarificationError = null;
  detailOpener = null;
  applicantDetailSection.hidden = true;
  applicantDetailBody.replaceChildren();
  applicantDetailTitle.textContent = "";
  applicantDetailStatus.textContent = "";
  applicantDetailStatus.hidden = true;
}

function renderApplicantDetail() {
  applicantDetailSection.hidden = !selectedApplicantId;
  if (!selectedApplicantId) return;
  applicantDetailBody.replaceChildren();
  applicantDetailTitle.textContent = selectedApplicantId ?? t("landlord.detail.title");
  applicantDetailStatus.hidden = Boolean(applicantDetail);
  applicantDetailStatus.textContent = applicantDetail ? "" : applicantDetailError ?? t("landlord.detail.loading");
  if (!applicantDetail) return;

  const view = applicantDetailView(applicantDetail);
  const heading = (key) => applicantDetailBody.append(el("h3", "", t(`landlord.detail.${key}`)));
  const facts = (items) => {
    const list = el("dl", "applicant-detail-facts");
    for (const { label, value } of items) fact(list, label, value);
    applicantDetailBody.append(list);
  };
  applicantDetailBody.append(shortlistButton(selectedApplicantId, "detail"));
  facts(view.facts);

  heading("documents");
  const documents = el("ul", "applicant-detail-list");
  for (const { label, status, reason } of view.documents) {
    const item = el("li");
    item.append(el("strong", "", `${label}: ${status}`));
    if (reason) item.append(el("p", "", reason));
    documents.append(item);
  }
  applicantDetailBody.append(documents);

  heading("issues");
  if (view.issues.length) {
    const issues = el("ul", "applicant-detail-list");
    for (const { label, message } of view.issues) issues.append(el("li", "", `${label}: ${message}`));
    applicantDetailBody.append(issues);
  } else applicantDetailBody.append(el("p", "landlord-hint", t("landlord.detail.noIssues")));

  renderClarification(view.clarification);

  heading(view.exclusion ? "excluded" : "score");
  if (view.exclusion) applicantDetailBody.append(el("p", "landlord-note", view.exclusion));
  else if (view.matchScore === null) applicantDetailBody.append(el("p", "landlord-hint", t("landlord.detail.listingRequired")));
  else {
    applicantDetailBody.append(el("p", "applicant-detail-score", `${view.matchScore}/100`));
    const breakdown = el("div", "applicant-detail-breakdown");
    for (const { label, percent, weight } of view.breakdown) {
      const row = el("div", "applicant-detail-breakdown-row");
      const progress = el("progress");
      progress.max = 100;
      progress.value = percent;
      progress.setAttribute("aria-label", `${label}: ${percent} %`);
      row.append(el("span", "", label), progress, el("span", "", `${percent} % · ${t("landlord.detail.weight", { weight })}`));
      breakdown.append(row);
    }
    applicantDetailBody.append(breakdown);
  }

}

function renderClarification(view) {
  if (!view) return;
  const panel = el("section", "applicant-clarification");
  panel.setAttribute("aria-labelledby", "clarification-title");
  const title = el("h3", "", t("landlord.clarification.title"));
  title.id = "clarification-title";
  const status = el("p", "landlord-note", view.status);
  status.setAttribute("role", "status");
  panel.append(title, el("p", "", t("landlord.clarification.intro")), status, el("p", "landlord-hint", view.landlordMessage));
  const list = el("dl", "applicant-detail-facts");
  fact(list, t("landlord.clarification.affected"), view.documents);
  if (view.deadline) fact(list, t("landlord.clarification.deadline"), view.deadline);
  panel.append(list, el("p", "landlord-hint", t("landlord.clarification.noPenalty")));
  if (view.canRequest) {
    const button = el("button", "landlord-btn", t(`landlord.clarification.${clarificationBusy ? "saving" : "simulate"}`));
    button.type = "button";
    button.disabled = clarificationBusy;
    button.addEventListener("click", simulateClarification);
    panel.append(button);
  }
  if (clarificationError) {
    const error = el("p", "landlord-error", clarificationError);
    error.setAttribute("role", "alert");
    panel.append(error);
  }
  for (const draft of view.drafts) {
    const section = el("details", "clarification-draft");
    section.open = draft.channel === "email";
    const label = t(`landlord.clarification.${draft.channel}`);
    section.append(el("summary", "", label), el("p", "", draft.recipient));
    const text = el("textarea");
    text.value = draft.text;
    text.readOnly = true;
    text.rows = 10;
    text.setAttribute("aria-label", label);
    const button = el("button", "landlord-btn", t("landlord.clarification.copy"));
    button.type = "button";
    const feedback = el("p", "landlord-hint");
    feedback.setAttribute("role", "status");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(draft.text);
        feedback.textContent = t("landlord.clarification.copied");
      } catch {
        text.focus();
        text.select();
        feedback.textContent = t("landlord.clarification.copyFailed");
      }
    });
    section.append(text, button, feedback);
    panel.append(section);
  }
  applicantDetailBody.append(panel);
}

async function simulateClarification() {
  if (!landlord || !selectedApplicantId || clarificationBusy) return;
  const request = detailRequest;
  const landlordId = landlord.landlordId;
  const applicantId = selectedApplicantId;
  clarificationBusy = true;
  clarificationError = null;
  renderApplicantDetail();
  try {
    const result = await requestClarification({ fetchImpl: fetch, landlordId, applicantId });
    if (request !== detailRequest) return;
    if (result.signedOut) return signOut();
    if (result.notFound) clarificationError = t("landlord.detail.unavailable");
    else applicantDetail = result;
  } catch (error) {
    if (request === detailRequest) clarificationError = error.message;
  } finally {
    if (request === detailRequest) {
      clarificationBusy = false;
      renderApplicantDetail();
    }
  }
}

async function openApplicant(applicantId, opener) {
  if (!landlord) return;
  selectTab("ranking");
  const request = ++detailRequest;
  detailOpener = opener;
  selectedApplicantId = applicantId;
  applicantDetail = null;
  applicantDetailError = null;
  clarificationBusy = false;
  clarificationError = null;
  renderApplicantDetail();
  applicantDetailSection.scrollIntoView({ block: "start" });
  applicantDetailTitle.focus();
  try {
    const result = await fetchApplicantProfile({ fetchImpl: fetch, landlordId: landlord.landlordId, applicantId });
    if (request !== detailRequest) return;
    if (result.signedOut) return signOut();
    if (result.notFound) applicantDetailError = t("landlord.detail.unavailable");
    else applicantDetail = result;
  } catch (error) {
    if (request !== detailRequest) return;
    applicantDetailError = error.message;
  }
  renderApplicantDetail();
}

applicantDetailClose.addEventListener("click", () => {
  const opener = detailOpener;
  closeApplicantDetail();
  if (opener?.isConnected) opener.focus();
  else $("#ranking-title").focus();
});

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
  fact(facts, t("landlord.buildingAge"), listing.buildingAge?.class, buildingAgeDetail(listing));
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
      const name = openButton(card.applicantId, card.applicantId);
      name.classList.add("recommendation-name");
      head.append(
        name,
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
    renderApplicantDetail();
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

// "Add to Shortlist" for the ranking, the Recommendation cards and the profile panel (`place`);
// "On the Shortlist" once added.
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
  if (tabShortlistCount) {
    tabShortlistCount.textContent = `(${shortlist.length})`;
  }
  updateTabVisibility();
  if (!ranking) return;
  const rows = shortlistRows(shortlist);
  shortlistEmpty.hidden = rows.length > 0;
  shortlistList.replaceChildren(
    ...rows.map((row) => {
      const item = el("li", `shortlist-entry is-${row.status}`);
      item.dataset.applicantId = row.applicantId;
      const head = el("div", "shortlist-head");
      head.append(el("span", "shortlist-name", row.applicantId), el("span", "shortlist-score", row.score));

      const status = el("select", "shortlist-status");
      status.dataset.focusKey = `status:${row.applicantId}`;
      status.setAttribute("aria-label", `${t("landlord.shortlist.statusLabel")}: ${row.applicantId}`);
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
      note.setAttribute("aria-label", `${t("landlord.shortlist.noteLabel")}: ${row.applicantId}`);
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

// --- the remembered preferences ------------------------------------------------------------------

// Deletes one remembered preference; the list drops it once the server confirms (or reports it
// already gone). On a failure the list is redrawn as it was, so its Delete button works again.
async function removeNote(noteId) {
  if (!landlord) return;
  const landlordId = landlord.landlordId;
  const index = (notes ?? []).findIndex((entry) => entry.noteId === noteId);
  showError(preferencesError, null);
  let result;
  try {
    result = await deleteNote({ fetchImpl: fetch, landlordId, noteId });
  } catch (error) {
    showError(preferencesError, error.message);
    renderPreferences();
    return;
  }
  if (landlord?.landlordId !== landlordId) return;
  if (result.signedOut) {
    signOut();
    return;
  }
  if (result.notFound) showError(preferencesError, t("landlord.preferences.notFound"));
  notes = withoutNote(notes ?? [], noteId);
  renderPreferences();
  // Keep the keyboard focus in the list: on the Delete button that took the deleted one's place
  // (or the last one), or on the section heading when the list is empty.
  const buttons = preferencesList.querySelectorAll("button");
  (buttons[Math.min(Math.max(index, 0), buttons.length - 1)] ?? $("#preferences-title"))?.focus();
}

function renderPreferences() {
  preferencesSection.hidden = !landlord || notes === null;
  if (preferencesSection.hidden) return;
  const rows = preferenceRows(notes);
  preferencesEmpty.hidden = rows.length > 0;
  preferencesList.replaceChildren(
    ...rows.map((row) => {
      const item = el("li", "preferences-entry");
      const text = el("div", "preferences-text");
      text.append(el("span", "preferences-note", row.note), el("span", "preferences-date", row.date));
      const remove = el("button", "landlord-link-btn preferences-delete", t("landlord.preferences.delete"));
      remove.type = "button";
      remove.setAttribute("aria-label", row.deleteLabel);
      remove.addEventListener("click", () => {
        remove.disabled = true;
        removeNote(row.noteId);
      });
      item.append(text, remove);
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
      cell(openButton(entry.applicantId, entry.applicantId));
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
      const name = openButton(entry.applicantId, entry.applicantId);
      name.classList.add("excluded-name");
      item.append(name, el("span", "", entry.reasons.map(exclusionText).join(" ")));
      return item;
    }),
  );
}

rankingSort.addEventListener("change", renderRanking);
rankingCompleteOnly.addEventListener("change", renderRanking);

// --- actions -----------------------------------------------------------------------------------

function signOut() {
  closeApplicantDetail();
  forgetLandlord(localStore());
  landlord = null;
  listing = null;
  ranking = null;
  poolOverview = null;
  shortlist = [];
  notes = null;
  defaultCriteria = null;
  criteriaForm.reset();
  criteriaStatusKey = null;
  clearCriteriaProblems();
  fillForm(listingFormValues(null));
  chatMessages.replaceChildren();
  showFieldProblems();
  showError(listingError, null);
  renderSignedIn();
  renderRentCheck();
  renderPoolOverview();
  renderShortlist();
  renderRanking();
  renderPreferences();
  showError(preferencesError, null);
  signInName.focus();
}

async function loadDashboard() {
  const landlordId = landlord.landlordId;
  try {
    const dashboard = await fetchDashboard({ fetchImpl: fetch, landlordId });
    if (landlord?.landlordId !== landlordId) return;
    closeApplicantDetail();
    if (dashboard.signedOut) {
      signOut();
      return;
    }
    applyDashboard(dashboard);
    fillForm(listingFormValues(dashboard.listing));
  } catch (error) {
    showError(listingError, error.message);
  }
}

function applyDashboard(dashboard) {
  listing = dashboard.listing;
  const { ranked, excluded, hint, poolErrors, stats, recommendations } = dashboard;
  ranking = { ranked, excluded, hint, poolErrors };
  poolOverview = { stats, recommendations };
  shortlist = dashboard.shortlist;
  notes = dashboard.notes ?? [];
  defaultCriteria = dashboard.defaultCriteria;
  for (const [key, value] of Object.entries(criteriaFormValues(dashboard.criteria))) {
    const input = criteriaForm.elements[key];
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
  }
  criteriaSection.hidden = false;
  renderCriteriaText();
  renderRentCheck();
  renderPoolOverview();
  renderShortlist();
  renderRanking();
  renderPreferences();
  updateTabVisibility();
}

function renderCriteriaText() {
  for (const key of WEIGHT_FIELDS) {
    const input = criteriaForm.elements[key];
    const val = Number(input?.value || 0);
    const node = $(`#criteria-value-${key}`);
    if (node) node.textContent = formatNumber(val);
    if (input?.style?.setProperty) {
      input.style.setProperty("--slider-pct", `${Math.min(100, Math.max(0, val))}%`);
    }
  }
  criteriaStatus.textContent = criteriaStatusKey ? t(criteriaStatusKey) : "";
  showError(criteriaError, criteriaErrorKey ? t(criteriaErrorKey) : null);
}

function clearCriteriaProblems() {
  criteriaErrorKey = null;
  for (const input of criteriaForm.querySelectorAll("input")) input.removeAttribute("aria-invalid");
  renderCriteriaText();
}

async function submitCriteria(request) {
  if (!landlord || criteriaControls.disabled) return;
  const landlordId = landlord.landlordId;
  clearCriteriaProblems();
  criteriaStatusKey = "landlord.criteria.saving";
  criteriaControls.disabled = true;
  renderCriteriaText();
  try {
    const result = await saveCriteria({ fetchImpl: fetch, landlordId, request });
    if (landlord?.landlordId !== landlordId) return;
    criteriaStatusKey = null;
    if (result.signedOut) signOut();
    else if (result.problems) {
      criteriaErrorKey = Object.values(result.problems).includes("positive_total")
        ? "landlord.criteria.positiveTotal" : "landlord.criteria.invalid";
      for (const field of Object.keys(result.problems)) {
        const keys = field === "weights" ? WEIGHT_FIELDS : [field.split(".").at(-1)];
        for (const key of keys) criteriaForm.elements[key]?.setAttribute("aria-invalid", "true");
      }
    } else {
      criteriaStatusKey = "landlord.criteria.saved";
      applyDashboard(result.dashboard);
    }
  } catch {
    if (landlord?.landlordId === landlordId) {
      criteriaStatusKey = null;
      criteriaErrorKey = "landlord.errors.failed";
    }
  } finally {
    criteriaControls.disabled = false;
    renderCriteriaText();
  }
}

criteriaForm.addEventListener("input", (event) => {
  criteriaStatusKey = null;
  clearCriteriaProblems();
  if (event.target?.type === "range") {
    const val = Number(event.target.value);
    const node = $(`#criteria-value-${event.target.name}`);
    if (node) node.textContent = formatNumber(val);
    if (event.target?.style?.setProperty) {
      event.target.style.setProperty("--slider-pct", `${Math.min(100, Math.max(0, val))}%`);
    }
  }
});
criteriaForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCriteria(criteriaRequest(Object.fromEntries(new FormData(criteriaForm))));
});
resetCriteriaButton.addEventListener("click", () => submitCriteria(defaultCriteria));

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
// An answer in two parts (splitAnswer) shows here as one message, without the separator line.
function drawTurn(item, state) {
  const answer = splitAnswer(state.answer).filter(Boolean).join("\n\n");
  item.classList.toggle("is-pending", state.phase === "streaming" && !answer);
  item.classList.toggle("is-error", state.phase === "error");
  if (state.phase === "error" && !answer) item.textContent = state.error;
  else if (answer) item.innerHTML = renderMarkdown(answer);
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
    // A turn that changed the Selection criteria, the Shortlist or the remembered preferences: fetch
    // the dashboard again, so it shows them.
    else if (changedDashboard(state)) await loadDashboard();
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

document.querySelectorAll(".landlord-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectTab(btn.dataset.tab);
  });
});

onLanguageChange(() => {
  renderCriteriaText();
  renderSignedIn();
  renderRentCheck();
  renderPoolOverview();
  renderShortlist();
  renderRanking();
  renderApplicantDetail();
  renderPreferences();
});

startI18n();
renderSignedIn();

const search = typeof window !== "undefined" && window?.location?.search ? window.location.search : "";
const urlName = new URLSearchParams(search).get("name")?.trim();
if (urlName && (!landlord || landlord.name !== urlName)) {
  signIn({ fetchImpl: fetch, name: urlName })
    .then((user) => {
      landlord = user;
      rememberLandlord(localStore(), landlord);
      renderSignedIn();
      return loadDashboard();
    })
    .catch(() => {
      if (landlord) loadDashboard();
    });
} else if (landlord) {
  loadDashboard();
}

import test from "node:test";
import assert from "node:assert/strict";

import { excludedTip, fillSlots, sidebarRows, slotCard } from "../../public/landlord/board.js";
import { setLanguage } from "../../public/i18n.js";

// The chat-first page's board (docs/plan/2026-09-30-landlord-chat-first.md, "Round 2"): two
// Recommendation slots picked at random from the top 6 not-hidden applicants, and the Shortlist
// sidebar, from GET /api/v1/landlord/:landlordId/overview.

const entry = (applicantId, rank, extra = {}) => ({
  applicantId,
  name: `Name ${applicantId}`,
  householdShape: "single",
  rank,
  matchScore: 90 - rank,
  reason: { de: `Grund ${applicantId}`, en: `Reason ${applicantId}` },
  rating: null,
  bonus: 0,
  ...extra,
});
const ids = (count) => Array.from({ length: count }, (_, index) => `A-${String(index + 1).padStart(3, "0")}`);
const RANKED = ids(9).map((id, index) => entry(id, index + 1));

// A fake random source returning the given values in turn (and counting its calls).
function randomOf(...values) {
  const random = () => {
    random.calls += 1;
    return values.shift() ?? 0;
  };
  random.calls = 0;
  return random;
}

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("empty slots get random picks from the top 6, in slot order, never the same applicant twice", () => {
  // Candidates A-001…A-006. Slot 1: 0.5 × 6 → index 3 → A-004. Slot 2: the other five
  // (A-001, A-002, A-003, A-005, A-006), 0.99 × 5 → index 4 → A-006.
  assert.deepEqual(fillSlots({ ranked: RANKED, current: [null, null], hidden: new Set(), random: randomOf(0.5, 0.99) }), ["A-004", "A-006"]);
});

test("a random source that always returns 0 picks the best two (the deterministic case)", () => {
  assert.deepEqual(fillSlots({ ranked: RANKED, random: () => 0 }), ["A-001", "A-002"]);
});

test("the 7th-ranked applicant is never picked", () => {
  for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
    const [first] = fillSlots({ ranked: RANKED, current: [null, "A-001"], random: () => value });
    assert.ok(["A-002", "A-003", "A-004", "A-005", "A-006"].includes(first), `${value} → ${first}`);
  }
});

test("hidden applicants (shortlisted or skipped) are not candidates; the top 6 is counted without them", () => {
  const hidden = new Set(["A-001", "A-002"]);
  // Candidates A-003…A-008; 0.999 × 6 → the last, A-008; then 0 → the best left, A-003.
  assert.deepEqual(fillSlots({ ranked: RANKED, current: [null, null], hidden, random: randomOf(0.999, 0) }), ["A-008", "A-003"]);
});

test("an applicant stays in their slot while among the top 6; only freed slots are drawn, the other stays put", () => {
  const random = randomOf(0);
  // A-005 in slot 2 is still in the top 6 (A-001 is now hidden): kept. Slot 1 (A-001) is freed and
  // drawn from A-002, A-003, A-004, A-006, A-007: 0 → A-002.
  assert.deepEqual(fillSlots({ ranked: RANKED, current: ["A-001", "A-005"], hidden: new Set(["A-001"]), random }), ["A-002", "A-005"]);
  assert.equal(random.calls, 1, "one draw for the one freed slot");
});

test("after the ranking changes, an applicant who dropped out of the top 6 leaves their slot", () => {
  // A-002 is now 8th.
  const reranked = ["A-001", "A-003", "A-004", "A-005", "A-006", "A-007", "A-008", "A-002", "A-009"].map((id, index) => entry(id, index + 1));
  assert.deepEqual(fillSlots({ ranked: reranked, current: ["A-006", "A-002"], random: () => 0 }), ["A-006", "A-001"]);
});

test("an applicant no longer ranked (now excluded) leaves their slot", () => {
  const withoutFirst = RANKED.filter(({ applicantId }) => applicantId !== "A-001");
  assert.deepEqual(fillSlots({ ranked: withoutFirst, current: ["A-001", "A-002"], random: () => 0 }), ["A-003", "A-002"]);
});

test("poolSize sets how many of the best are candidates", () => {
  assert.deepEqual(fillSlots({ ranked: RANKED, current: [null, null], poolSize: 2, random: () => 0.999 }), ["A-002", "A-001"]);
});

test("when fewer applicants are left than slots, the rest stay empty (null); with nobody left, nothing is drawn", () => {
  const random = randomOf();
  const hidden = new Set(ids(8));
  assert.deepEqual(fillSlots({ ranked: RANKED, current: [null, null], hidden, random }), ["A-009", null]);
  const before = random.calls;
  assert.deepEqual(fillSlots({ ranked: [], current: [null, null], random }), [null, null]);
  assert.equal(random.calls, before, "no draw without candidates");
});

test("a slot card: name, avatar shape, Match score, the rank move, the rank of the total, reason, rating and bonus (EN)", () => {
  const ranked = entry("A-007", 5, { matchScore: 94.7, householdShape: "family", rating: "up", bonus: 5 });
  assert.deepEqual(inLanguage("en", () => slotCard(ranked, { total: 35, move: 1 })), {
    applicantId: "A-007",
    name: "Name A-007",
    householdShape: "family",
    scoreText: "Match score 94.7",
    move: { text: "↑1", label: "moved up 1", direction: "up" },
    rankText: "#5 of 35",
    reason: "Reason A-007",
    rating: "up",
    bonusText: "+5 your bonus",
  });
});

test("a slot card in German, moved down, rated down, with a fractional bonus", () => {
  const ranked = entry("A-007", 5, { matchScore: 94.7, rating: "down", bonus: -6.5 });
  const card = inLanguage("de", () => slotCard(ranked, { total: 35, move: -2 }));
  assert.equal(card.scoreText, "Match-Score 94,7");
  assert.deepEqual(card.move, { text: "↓2", label: "um 2 abgestiegen", direction: "down" });
  assert.equal(card.rankText, "Platz 5 von 35");
  assert.equal(card.rating, "down");
  assert.equal(card.bonusText, "−6,5 Ihr Bonus");
});

test("an unrated, unmoved slot card has no move and no bonus text", () => {
  const card = inLanguage("en", () => slotCard(entry("A-007", 3), { total: 40 }));
  assert.equal(card.move, null);
  assert.equal(card.rating, null);
  assert.equal(card.bonusText, null);
});

// The exclusion reason is the short landlordChat.excludedBy label of the Requirement that excludes them.
test("sidebar rows: the current rank only (no move), status, note, whether a note is allowed, rating (EN and DE)", () => {
  const shortlist = [
    { applicantId: "A-007", name: "Lena Schmidt", householdShape: "couple", status: "to_invite", note: "Call Monday", rank: 2, matchScore: 91.2, excluded: false, excludedBy: null, rating: "up" },
    { applicantId: "A-017", name: "Ali Kaya", householdShape: "group", status: "declined", note: null, rank: null, matchScore: null, excluded: true, excludedBy: "noPets", rating: null },
    { applicantId: "A-020", name: "Mia Chen", householdShape: "single", status: "invited", note: null, rank: 4, matchScore: 90, excluded: false, excludedBy: null, rating: "down" },
  ];
  assert.deepEqual(inLanguage("en", () => sidebarRows(shortlist)), [
    { applicantId: "A-007", name: "Lena Schmidt", householdShape: "couple", placeText: "#2", excluded: false, status: "to_invite", statusText: "To invite", note: "Call Monday", noteAllowed: true, rating: "up", removeLabel: "Remove Lena Schmidt from the Shortlist" },
    { applicantId: "A-017", name: "Ali Kaya", householdShape: "group", placeText: "excluded: has pets", excluded: true, status: "declined", statusText: "Declined", note: null, noteAllowed: false, rating: null, removeLabel: "Remove Ali Kaya from the Shortlist" },
    { applicantId: "A-020", name: "Mia Chen", householdShape: "single", placeText: "#4", excluded: false, status: "invited", statusText: "Invited", note: null, noteAllowed: true, rating: "down", removeLabel: "Remove Mia Chen from the Shortlist" },
  ]);
  const [first, second] = inLanguage("de", () => sidebarRows(shortlist));
  assert.equal(first.placeText, "Platz 2");
  assert.equal(second.placeText, "ausgeschlossen: hat Haustiere");
  assert.equal(first.removeLabel, "Lena Schmidt von der Shortlist entfernen");
});

test("a sidebar row without a name shows the applicant id; a missing rating is null", () => {
  const [row] = inLanguage("en", () =>
    sidebarRows([{ applicantId: "A-099", name: null, householdShape: "single", status: "to_invite", note: null, rank: 5, excluded: false, excludedBy: null }]),
  );
  assert.equal(row.name, "A-099");
  assert.equal(row.rating, null);
});

// The "Excluded" tile's hover tip: why applicants are excluded, grouped by Requirement (each applicant
// counted once, under the first Requirement they fail — the overview's excludedByReason), largest
// group first, ties in the order of the Requirements.
test("the Excluded tip groups the reasons with their counts, largest first (EN and DE)", () => {
  const byReason = { noPets: 2, noSmoking: 5, completeDocumentsOnly: 2 };
  assert.equal(
    inLanguage("en", () => excludedTip(byReason)),
    "Excluded because: smokes (5), documents incomplete (2), has pets (2)",
  );
  assert.equal(
    inLanguage("de", () => excludedTip(byReason)),
    "Ausgeschlossen, weil: raucht (5), Unterlagen unvollständig (2), hat Haustiere (2)",
  );
});

test("the Excluded tip when nobody is excluded", () => {
  assert.equal(inLanguage("en", () => excludedTip({})), "Nobody is excluded.");
  assert.equal(inLanguage("en", () => excludedTip(undefined)), "Nobody is excluded.");
});

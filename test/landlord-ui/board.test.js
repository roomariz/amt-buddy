import test from "node:test";
import assert from "node:assert/strict";

import { fillSlots, sidebarRows, slotCard } from "../../public/landlord/board.js";
import { setLanguage } from "../../public/i18n.js";

// The chat-first page's board (docs/plan/2026-09-30-landlord-chat-first.md): two Recommendation
// slots and the Shortlist sidebar, from GET /api/v1/landlord/:landlordId/overview.

const entry = (applicantId, rank, extra = {}) => ({
  applicantId,
  name: `Name ${applicantId}`,
  householdShape: "single",
  rank,
  matchScore: 90 - rank,
  reason: { de: `Grund ${applicantId}`, en: `Reason ${applicantId}` },
  ...extra,
});
const RANKED = ["A-001", "A-002", "A-003", "A-004", "A-005"].map((id, index) => entry(id, index + 1));

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("empty slots are filled with the two best-ranked applicants, in rank order", () => {
  assert.deepEqual(fillSlots({ ranked: RANKED, current: [null, null], hidden: new Set() }), ["A-001", "A-002"]);
});

test("current and hidden default to two empty slots and nobody hidden", () => {
  assert.deepEqual(fillSlots({ ranked: RANKED }), ["A-001", "A-002"]);
});

test("an applicant moved to the Shortlist is replaced in the same slot; the other slot stays put", () => {
  // A-001 (slot 1) goes to the Shortlist: A-002 stays in slot 2, the next best fills slot 1.
  assert.deepEqual(fillSlots({ ranked: RANKED, current: ["A-001", "A-002"], hidden: new Set(["A-001"]) }), ["A-003", "A-002"]);
  // A-002 (slot 2) is skipped: slot 1 keeps A-001.
  assert.deepEqual(fillSlots({ ranked: RANKED, current: ["A-001", "A-002"], hidden: new Set(["A-002"]) }), ["A-001", "A-003"]);
});

test("the slots show the two best applicants not hidden: shortlisted and skipped ones are passed over", () => {
  const hidden = new Set(["A-001", "A-003"]);
  assert.deepEqual(fillSlots({ ranked: RANKED, current: [null, null], hidden }), ["A-002", "A-004"]);
});

test("after the ranking changes, an applicant still among the best two keeps their slot; the other slot gets the new best", () => {
  // The criteria changed: A-004 is now first, A-002 second, A-001 third.
  const reranked = [entry("A-004", 1), entry("A-002", 2), entry("A-001", 3), entry("A-003", 4), entry("A-005", 5)];
  assert.deepEqual(fillSlots({ ranked: reranked, current: ["A-001", "A-002"], hidden: new Set() }), ["A-004", "A-002"]);
});

test("an applicant no longer ranked (now excluded by a Requirement) leaves their slot", () => {
  const withoutFirst = RANKED.filter(({ applicantId }) => applicantId !== "A-001");
  assert.deepEqual(fillSlots({ ranked: withoutFirst, current: ["A-001", "A-002"], hidden: new Set() }), ["A-003", "A-002"]);
});

test("when fewer applicants are left than slots, the rest stay empty (null)", () => {
  const hidden = new Set(["A-001", "A-002", "A-003", "A-004"]);
  assert.deepEqual(fillSlots({ ranked: RANKED, current: ["A-003", "A-004"], hidden }), ["A-005", null]);
  assert.deepEqual(fillSlots({ ranked: [], current: [null, null], hidden: new Set() }), [null, null]);
});

test("a slot card has the name, household shape, rank of the total, Match score and reason, DE and EN", () => {
  const ranked = { ...entry("A-007", 3), matchScore: 87.5, householdShape: "family" };
  const de = inLanguage("de", () => slotCard(ranked, { total: 34 }));
  const en = inLanguage("en", () => slotCard(ranked, { total: 34 }));
  assert.deepEqual(de, {
    applicantId: "A-007",
    name: "Name A-007",
    householdShape: "family",
    rankText: "Platz 3 von 34",
    scoreText: "Match-Score 87,5",
    reason: "Grund A-007",
  });
  assert.deepEqual(en, {
    applicantId: "A-007",
    name: "Name A-007",
    householdShape: "family",
    rankText: "#3 of 34",
    scoreText: "Match score 87.5",
    reason: "Reason A-007",
  });
});

// The exclusion reason is the short landlordChat.excludedBy label of the Requirement that excludes them.
test("sidebar rows: name, household shape, the current rank or why excluded, and the status label, DE and EN", () => {
  // The Shortlist as the overview returns it (the dashboard's entries plus householdShape and excludedBy).
  const shortlist = [
    { applicantId: "A-007", name: "Lena Schmidt", householdShape: "couple", status: "to_invite", note: null, rank: 2, matchScore: 91.2, excluded: false, excludedBy: null },
    { applicantId: "A-017", name: "Ali Kaya", householdShape: "group", status: "invited", note: null, rank: null, matchScore: null, excluded: true, excludedBy: "noPets" },
  ];
  assert.deepEqual(inLanguage("en", () => sidebarRows(shortlist)), [
    { applicantId: "A-007", name: "Lena Schmidt", householdShape: "couple", placeText: "#2", excluded: false, statusText: "To invite", removeLabel: "Remove Lena Schmidt from the Shortlist" },
    { applicantId: "A-017", name: "Ali Kaya", householdShape: "group", placeText: "excluded: has pets", excluded: true, statusText: "Invited", removeLabel: "Remove Ali Kaya from the Shortlist" },
  ]);
  const [first, second] = inLanguage("de", () => sidebarRows(shortlist));
  assert.equal(first.placeText, "Platz 2");
  assert.equal(second.placeText, "ausgeschlossen: hat Haustiere");
  assert.equal(first.removeLabel, "Lena Schmidt von der Shortlist entfernen");
});

test("a sidebar row without a name shows the applicant id", () => {
  const [row] = inLanguage("en", () =>
    sidebarRows([{ applicantId: "A-099", name: null, householdShape: "single", status: "declined", rank: 5, excluded: false, excludedBy: null }]),
  );
  assert.equal(row.name, "A-099");
});

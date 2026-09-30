import test from "node:test";
import assert from "node:assert/strict";

import { applyShortlistChange, isShortlisted, SHORTLIST_STATUSES, shortlistRows, statusOptions } from "../../public/landlord/shortlist.js";
import { setLanguage } from "../../public/i18n.js";

// The Shortlist as GET /api/v1/landlord/:landlordId/dashboard returns it.
const SHORTLIST = [
  { applicantId: "A-007", name: "Lena Schmidt", status: "to_invite", note: "Stable income", rank: 1, matchScore: 94.2, excluded: false },
  { applicantId: "A-017", name: "Ali Kaya", status: "declined", note: null, rank: null, matchScore: null, excluded: true },
  { applicantId: "A-003", name: "Mia Wolf", status: "invited", note: null, rank: null, matchScore: null, excluded: false },
];

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("the three statuses, in the order the status menu offers them", () => {
  assert.deepEqual(SHORTLIST_STATUSES, ["to_invite", "invited", "declined"]);
});

test("each row has its anonymous id, the score or why there is none, the status and the note, DE and EN", () => {
  const en = inLanguage("en", () => shortlistRows(SHORTLIST));
  const de = inLanguage("de", () => shortlistRows(SHORTLIST));

  assert.deepEqual(en, [
    { applicantId: "A-007", score: "Match score 94.2", status: "to_invite", note: "Stable income" },
    { applicantId: "A-017", score: "Excluded", status: "declined", note: "" },
    { applicantId: "A-003", score: "No score yet", status: "invited", note: "" },
  ]);
  assert.deepEqual(de.map(({ score }) => score), ["Match-Score 94,2", "Ausgeschlossen", "Noch kein Score"]);
});

test("the status menu offers every status with its label in the page language", () => {
  assert.deepEqual(inLanguage("en", statusOptions), [
    { value: "to_invite", label: "To invite" },
    { value: "invited", label: "Invited" },
    { value: "declined", label: "Declined" },
  ]);
  assert.deepEqual(inLanguage("de", statusOptions).map(({ label }) => label), ["Einladen", "Eingeladen", "Abgelehnt"]);
});

test("an applicant no longer in the pool is shown by id", () => {
  const [row] = shortlistRows([{ ...SHORTLIST[0], name: null }]);

  assert.equal(row.applicantId, "A-007");
});

test("isShortlisted tells whether an applicant is on the Shortlist", () => {
  assert.equal(isShortlisted(SHORTLIST, "A-017"), true);
  assert.equal(isShortlisted(SHORTLIST, "A-001"), false);
  assert.equal(isShortlisted([], "A-007"), false);
});

// The ranking as the dashboard returns it (only the fields applyShortlistChange reads).
const RANKING = {
  ranked: [
    { applicantId: "A-007", name: "Lena Schmidt", rank: 1, matchScore: 94.2 },
    { applicantId: "A-009", name: "Jonas Berg", rank: 2, matchScore: 90 },
  ],
  excluded: [{ applicantId: "A-017", name: "Ali Kaya" }],
};

test("a saved change updates the entry in place, keeping its position and score", () => {
  const next = applyShortlistChange(SHORTLIST, { applicantId: "A-017", status: "invited", note: "Call" }, RANKING);

  assert.deepEqual(next.map(({ applicantId }) => applicantId), ["A-007", "A-017", "A-003"]);
  assert.deepEqual(next[1], { ...SHORTLIST[1], status: "invited", note: "Call" });
  assert.equal(SHORTLIST[1].status, "declined", "the old list is not changed");
});

test("a newly added applicant goes to the end, with rank and score from the ranking", () => {
  const ranked = applyShortlistChange(SHORTLIST, { applicantId: "A-009", status: "to_invite", note: null }, RANKING);
  const excluded = applyShortlistChange([], { applicantId: "A-017", status: "to_invite", note: null }, RANKING);
  const unknown = applyShortlistChange([], { applicantId: "A-099", status: "to_invite", note: null }, RANKING);

  assert.deepEqual(ranked.at(-1), { applicantId: "A-009", status: "to_invite", note: null, rank: 2, matchScore: 90, excluded: false });
  assert.deepEqual(excluded[0], { applicantId: "A-017", status: "to_invite", note: null, rank: null, matchScore: null, excluded: true });
  assert.deepEqual(unknown[0], { applicantId: "A-099", status: "to_invite", note: null, rank: null, matchScore: null, excluded: false });
});

test("a removal takes the entry off", () => {
  const next = applyShortlistChange(SHORTLIST, { applicantId: "A-007", status: "removed", note: null }, RANKING);

  assert.deepEqual(next.map(({ applicantId }) => applicantId), ["A-017", "A-003"]);
});

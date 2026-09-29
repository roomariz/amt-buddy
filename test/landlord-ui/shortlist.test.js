import test from "node:test";
import assert from "node:assert/strict";

import { isShortlisted, SHORTLIST_STATUSES, shortlistRows } from "../../public/landlord/shortlist.js";
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

test("each row has the name, the score or why there is none, the status and the note, DE and EN", () => {
  const en = inLanguage("en", () => shortlistRows(SHORTLIST));
  const de = inLanguage("de", () => shortlistRows(SHORTLIST));

  assert.deepEqual(
    en.map(({ applicantId, name, score, status, statusLabel, note }) => ({ applicantId, name, score, status, statusLabel, note })),
    [
      { applicantId: "A-007", name: "Lena Schmidt", score: "Match score 94.2", status: "to_invite", statusLabel: "To invite", note: "Stable income" },
      { applicantId: "A-017", name: "Ali Kaya", score: "Excluded", status: "declined", statusLabel: "Declined", note: "" },
      { applicantId: "A-003", name: "Mia Wolf", score: "No score yet", status: "invited", statusLabel: "Invited", note: "" },
    ],
  );
  assert.deepEqual(
    de.map(({ score, statusLabel }) => [score, statusLabel]),
    [
      ["Match-Score 94,2", "Einladen"],
      ["Ausgeschlossen", "Abgelehnt"],
      ["Noch kein Score", "Eingeladen"],
    ],
  );
});

test("an applicant no longer in the pool is shown by id", () => {
  const [row] = shortlistRows([{ ...SHORTLIST[0], name: null }]);

  assert.equal(row.name, "A-007");
});

test("isShortlisted tells whether an applicant is on the Shortlist", () => {
  assert.equal(isShortlisted(SHORTLIST, "A-017"), true);
  assert.equal(isShortlisted(SHORTLIST, "A-001"), false);
  assert.equal(isShortlisted([], "A-007"), false);
});

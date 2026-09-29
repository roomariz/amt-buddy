import test from "node:test";
import assert from "node:assert/strict";

import { moveText, rankMoves } from "../../public/landlord/rank-moves.js";
import { setLanguage } from "../../public/i18n.js";

// How far each applicant moved in the ranking with the last change of the criteria or the flat
// details (docs/plan/2026-09-30-landlord-chat-first.md, "Rank movement").

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

const ranked = (...ids) => ids.map((applicantId, index) => ({ applicantId, rank: index + 1 }));

test("positive moves are up the ranking (a smaller rank number), negative down", () => {
  const before = ranked("A-001", "A-002", "A-003", "A-004");
  const after = ranked("A-003", "A-001", "A-002", "A-004");
  const moves = rankMoves(before, after);
  assert.ok(moves instanceof Map);
  assert.deepEqual([...moves].sort(), [
    ["A-001", -1],
    ["A-002", -1],
    ["A-003", 2],
  ]);
});

test("unmoved applicants, and applicants not ranked before or after, have no entry", () => {
  const before = ranked("A-001", "A-002", "A-009");
  const after = ranked("A-001", "A-005", "A-002");
  // A-001 did not move; A-009 is no longer ranked; A-005 was not ranked before; A-002 moved 2 → 3.
  assert.deepEqual([...rankMoves(before, after)], [["A-002", -1]]);
});

test("no previous ranking: no moves", () => {
  assert.equal(rankMoves(null, ranked("A-001")).size, 0);
  assert.equal(rankMoves([], ranked("A-001")).size, 0);
});

test("moveText: an arrow with the count and a spoken label, DE and EN; nothing for no move", () => {
  assert.deepEqual(inLanguage("en", () => moveText(2)), { text: "↑2", label: "moved up 2" });
  assert.deepEqual(inLanguage("en", () => moveText(-1)), { text: "↓1", label: "moved down 1" });
  assert.deepEqual(inLanguage("de", () => moveText(3)), { text: "↑3", label: "um 3 aufgestiegen" });
  assert.deepEqual(inLanguage("de", () => moveText(-4)), { text: "↓4", label: "um 4 abgestiegen" });
  assert.equal(moveText(0), null);
  assert.equal(moveText(undefined), null);
});

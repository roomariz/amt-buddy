import test from "node:test";
import assert from "node:assert/strict";

import { topApplicantsMessage } from "../../public/landlord/top-message.js";
import { setLanguage } from "../../public/i18n.js";

// The chat's second message after a turn that changed the ranking (priorities, flat details or
// the bonus): the current top 3 by rank, written by code, not random and independent of the
// Recommendation slots (docs/plan/2026-09-30-landlord-chat-first.md, round 3).

const entry = (applicantId, rank, extra = {}) => ({
  applicantId,
  name: `Name ${applicantId}`,
  householdShape: "single",
  rank,
  matchScore: 90,
  reason: { de: `Grund ${applicantId}`, en: `Reason ${applicantId}` },
  rating: null,
  bonus: 0,
  ...extra,
});

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("the top 3 by rank, whatever order the list arrives in, with name, score, bonus and reason (EN)", () => {
  const ranked = [
    entry("A-013", 3, { matchScore: 100 }),
    entry("A-031", 1, { matchScore: 94.6, rating: "up", bonus: 5 }),
    entry("A-003", 2, { matchScore: 100 }),
    entry("A-020", 4, { matchScore: 100 }),
  ];
  assert.deepEqual(inLanguage("en", () => topApplicantsMessage(ranked)), {
    intro: "Here are your three best-matching applicants now:",
    items: [
      { applicantId: "A-031", name: "Name A-031", rank: 1, scoreText: "Match score 94.6", bonusText: "+5 your bonus", reason: "Reason A-031" },
      { applicantId: "A-003", name: "Name A-003", rank: 2, scoreText: "Match score 100", bonusText: null, reason: "Reason A-003" },
      { applicantId: "A-013", name: "Name A-013", rank: 3, scoreText: "Match score 100", bonusText: null, reason: "Reason A-013" },
    ],
  });
});

test("German, with a thumbs-down bonus", () => {
  const message = inLanguage("de", () => topApplicantsMessage([entry("A-007", 1, { matchScore: 88.5, rating: "down", bonus: -6.5 })]));
  assert.equal(message.intro, "Das sind jetzt Ihre am besten passenden Bewerber:");
  assert.deepEqual(message.items, [
    { applicantId: "A-007", name: "Name A-007", rank: 1, scoreText: "Match-Score 88,5", bonusText: "−6,5 Ihr Bonus", reason: "Grund A-007" },
  ]);
});

test("fewer than three ranked: the intro does not promise three; none ranked: no message (null)", () => {
  const two = inLanguage("en", () => topApplicantsMessage([entry("A-001", 1), entry("A-002", 2)]));
  assert.equal(two.intro, "Here are your best-matching applicants now:");
  assert.equal(two.items.length, 2);
  assert.equal(topApplicantsMessage([]), null);
  assert.equal(topApplicantsMessage(undefined), null);
});

test("a missing name falls back to the applicant id", () => {
  const [item] = inLanguage("en", () => topApplicantsMessage([entry("A-099", 1, { name: null })])).items;
  assert.equal(item.name, "A-099");
});

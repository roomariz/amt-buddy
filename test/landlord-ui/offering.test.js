import test from "node:test";
import assert from "node:assert/strict";

import { poolSummary, recommendationCards, statTiles } from "../../public/landlord/offering.js";
import { setLanguage } from "../../public/i18n.js";

// Stats and Recommendations as GET /api/v1/landlord/:landlordId/dashboard returns them.
const STATS = { total: 40, completeDocuments: 19, canAfford: 22, canAffordAtMedian: 31, cleanSchufa: 24, excluded: 4, maxRentToIncome: 1 / 3, medianRent: 490 };

const RECOMMENDATIONS = [
  {
    applicantId: "A-007",
    rank: 1,
    matchScore: 94.2,
    name: "Lena Schmidt",
    strengths: ["affordability", "schufa", "documents"],
    weakness: null,
    reason: { de: "Dieser Bewerber könnte Ihnen gefallen: saubere SCHUFA.", en: "You may like this applicant for their clean SCHUFA." },
  },
  {
    applicantId: "A-003",
    rank: 2,
    matchScore: 88,
    name: "Ali Kaya",
    strengths: ["documents"],
    weakness: "schufa",
    reason: { de: "Dieser Bewerber könnte Ihnen gefallen: vollständige Unterlagen.", en: "You may like this applicant for their complete documents." },
  },
];

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("the summary says how many applicants there are and how many can afford the rent, DE and EN", () => {
  assert.equal(inLanguage("en", () => poolSummary(STATS)), "You have 40 applicants, 22 can afford this rent.");
  assert.equal(inLanguage("de", () => poolSummary(STATS)), "Sie haben 40 Bewerber, 22 können sich diese Miete leisten.");
  assert.equal(poolSummary(null), null);
});

test("the stat tiles: one per count, in order, with its label in the page language", () => {
  const tiles = inLanguage("en", () => statTiles(STATS));

  assert.deepEqual(
    tiles.map(({ stat, value, available }) => [stat, value, available]),
    [
      ["total", "40", true],
      ["completeDocuments", "19", true],
      ["canAfford", "22", true],
      ["canAffordAtMedian", "31", true],
      ["cleanSchufa", "24", true],
      ["excluded", "4", true],
    ],
  );
  for (const tile of tiles) assert.ok(tile.label && !tile.label.startsWith("landlord."), tile.label);
  const byStat = Object.fromEntries(tiles.map((tile) => [tile.stat, tile]));
  assert.equal(byStat.canAfford.detail, "Rent at most 33.3 % of net household income");
  assert.equal(byStat.canAffordAtMedian.detail, "At the Mietspiegel median of €490.00: 9 more");
  // German puts a no-break space before the euro sign.
  assert.match(inLanguage("de", () => statTiles(STATS))[3].detail, /^Zur Mietspiegel-Mitte von 490,00\s€: 9 mehr$/);
  assert.equal(inLanguage("en", () => statTiles({ ...STATS, medianRent: 800, canAffordAtMedian: 20 }))[3].detail, "At the Mietspiegel median of €800.00: 2 fewer");
});

test("without a Rent check the median tile is shown as unavailable, not as zero", () => {
  const tiles = inLanguage("en", () => statTiles({ ...STATS, canAffordAtMedian: null, medianRent: null }));
  const median = tiles.find(({ stat }) => stat === "canAffordAtMedian");

  assert.equal(median.available, false);
  assert.equal(median.value, "–");
  assert.equal(median.detail, "Not available: the Listing has no Rent check");
  assert.equal(statTiles(null).length, 0);
});

test("the Recommendation cards carry the name, the Match score and the reason in the page language", () => {
  const en = inLanguage("en", () => recommendationCards(RECOMMENDATIONS));
  const de = inLanguage("de", () => recommendationCards(RECOMMENDATIONS));

  assert.deepEqual(en[0], { applicantId: "A-007", rank: 1, name: "Lena Schmidt", matchScore: "94.2", reason: "You may like this applicant for their clean SCHUFA." });
  assert.equal(de[0].matchScore, "94,2");
  assert.equal(de[1].reason, "Dieser Bewerber könnte Ihnen gefallen: vollständige Unterlagen.");
  assert.deepEqual(recommendationCards([]), []);
});

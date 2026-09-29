import test from "node:test";
import assert from "node:assert/strict";

import { landlordTips } from "../../public/landlord/tips.js";
import { setLanguage } from "../../public/i18n.js";

// The rotating tips below the chat-first page's prompt (docs/plan/2026-09-30-landlord-chat-first.md,
// "Tips"): a pure function of the overview. The expected shares below are worked out by hand from
// the default weights (affordability 30, SCHUFA 20, documents 15, credibility 15, employment 15,
// previous landlord 5): without an asking rent affordability is off and the other 70 are
// renormalised (SCHUFA 20/70 = 28.57 %, the three 15s 21.43 % each, previous landlord 7.14 %).

const WEIGHTS = { affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 };
const REQUIREMENTS_OFF = {
  schufaCleanOnly: false,
  completeDocumentsOnly: false,
  maxRentToIncome: null,
  noPets: false,
  noSmoking: false,
  latestMoveIn: null,
  occupancyCompliant: true,
};
const NO_FLAT = { address: null, livingAreaSqm: null, rooms: null, askingRent: null, buildingYear: null };
const RANKED = [
  { applicantId: "A-004", name: "N4", householdShape: "single", rank: 1, matchScore: 91, reason: { de: "", en: "" } },
  { applicantId: "A-011", name: "N11", householdShape: "couple", rank: 2, matchScore: 88, reason: { de: "", en: "" } },
];

// The overview before the landlord has said anything about the flat.
const firstVisit = () => ({
  criteria: {
    weights: WEIGHTS,
    activeWeights: { affordability: 0, schufa: 28.6, documents: 21.4, credibility: 21.4, employment: 21.4, previousLandlord: 7.1 },
    requirements: REQUIREMENTS_OFF,
  },
  inactive: [
    { criterion: "affordability", missing: ["askingRent"] },
    { requirement: "occupancyCompliant", missing: ["livingAreaSqm", "rooms"] },
  ],
  flat: NO_FLAT,
  rentCheck: null,
  ranked: RANKED,
});

// The overview once address, size, rooms and rent are known and the Rent check ran.
const fullListing = () => ({
  criteria: { weights: WEIGHTS, activeWeights: WEIGHTS, requirements: REQUIREMENTS_OFF },
  inactive: [],
  flat: { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 65, rooms: 2, askingRent: 1100, buildingYear: null },
  rentCheck: { range: { median: 11.2 } },
  ranked: RANKED,
});

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

const ids = (tips) => tips.map(({ id }) => id);

test("the first tip names the heaviest active criterion and suggests boosting the second heaviest (EN)", () => {
  const [first] = inLanguage("en", () => landlordTips(firstVisit()));
  assert.deepEqual(first, {
    id: "heaviest",
    text: "Applicants are currently ranked mostly by SCHUFA; ask me 'give Documents 30% more importance' to adapt it to your liking.",
    example: "give Documents 30% more importance",
  });
});

test("the first tip in German", () => {
  const [first] = inLanguage("de", () => landlordTips(firstVisit()));
  assert.equal(first.id, "heaviest");
  assert.equal(first.example, "Gib Unterlagen 30 % mehr Gewicht");
  assert.equal(first.text, "Die Bewerber werden gerade vor allem nach SCHUFA gereiht; sagen Sie zum Beispiel „Gib Unterlagen 30 % mehr Gewicht“, um das anzupassen.");
});

test("with a full Listing affordability is active and heaviest, SCHUFA the example", () => {
  const [first] = inLanguage("en", () => landlordTips(fullListing()));
  assert.equal(first.text, "Applicants are currently ranked mostly by Affordability; ask me 'give SCHUFA 30% more importance' to adapt it to your liking.");
});

test("first visit: the full order — heaviest, missing flat facts, other active criteria by share, Requirements that are off, then the always-tips", () => {
  assert.deepEqual(ids(inLanguage("en", () => landlordTips(firstVisit()))), [
    "heaviest",
    "noRent",
    "noSize",
    // Active criteria other than the heaviest, largest active share first, ties in criteria order.
    // Affordability is inactive (share 0): the noRent tip speaks for it.
    "criterion:documents",
    "criterion:credibility",
    "criterion:employment",
    "criterion:previousLandlord",
    "requirement:schufaCleanOnly",
    "requirement:completeDocumentsOnly",
    "requirement:maxRentToIncome",
    "requirement:noPets",
    "requirement:noSmoking",
    "requirement:latestMoveIn",
    "whyAbove",
    "tellMore",
    "markInvited",
    "memory",
  ]);
});

test("with a full Listing and Rent check there are no flat-fact tips", () => {
  const tips = ids(inLanguage("en", () => landlordTips(fullListing())));
  for (const id of ["noRent", "noSize", "noRentCheck"]) assert.ok(!tips.includes(id), id);
  assert.deepEqual(tips.filter((id) => id.startsWith("criterion:")), [
    "criterion:schufa",
    "criterion:documents",
    "criterion:credibility",
    "criterion:employment",
    "criterion:previousLandlord",
  ]);
});

test("rent known but no size, rooms or address: the size tip and the Mietspiegel tip, not the rent tip", () => {
  const overview = { ...firstVisit(), flat: { ...NO_FLAT, askingRent: 1100 } };
  const tips = inLanguage("en", () => landlordTips(overview));
  assert.deepEqual(ids(tips).slice(0, 3), ["heaviest", "noSize", "noRentCheck"]);
  const noRentCheck = tips.find(({ id }) => id === "noRentCheck");
  assert.deepEqual(noRentCheck, {
    id: "noRentCheck",
    text: "Tell me the address with postal code (e.g. 'Wühlischstraße 30, 10245 Berlin') to compare your rent with the Berlin Mietspiegel.",
    example: "Wühlischstraße 30, 10245 Berlin",
  });
});

test("the size tip shows while either the size or the rooms is missing", () => {
  const onlySize = { ...firstVisit(), flat: { ...NO_FLAT, livingAreaSqm: 65 } };
  assert.ok(ids(inLanguage("en", () => landlordTips(onlySize))).includes("noSize"));
  const both = { ...firstVisit(), flat: { ...NO_FLAT, livingAreaSqm: 65, rooms: 2 } };
  assert.ok(!ids(inLanguage("en", () => landlordTips(both))).includes("noSize"));
});

test("the rent tip's text and example", () => {
  const tip = inLanguage("en", () => landlordTips(firstVisit())).find(({ id }) => id === "noRent");
  assert.deepEqual(tip, {
    id: "noRent",
    text: "Affordability isn't counted yet: tell me the asking rent (e.g. 'the rent is €1,100') to judge whether applicants can afford it.",
    example: "the rent is €1,100",
  });
});

test("a criterion tip names the criterion by its label", () => {
  const tip = inLanguage("en", () => landlordTips(firstVisit())).find(({ id }) => id === "criterion:employment");
  assert.deepEqual(tip, {
    id: "criterion:employment",
    text: "Say 'Employment matters more to me' when Employment matters more or less to you.",
    example: "Employment matters more to me",
  });
});

test("a criterion at 0 % gets no tip", () => {
  const overview = firstVisit();
  overview.criteria = { ...overview.criteria, activeWeights: { ...overview.criteria.activeWeights, previousLandlord: 0 } };
  assert.ok(!ids(inLanguage("en", () => landlordTips(overview))).includes("criterion:previousLandlord"));
});

test("Requirements already on are not suggested", () => {
  const overview = firstVisit();
  overview.criteria = {
    ...overview.criteria,
    requirements: { ...REQUIREMENTS_OFF, schufaCleanOnly: true, maxRentToIncome: 0.33, latestMoveIn: "2026-12-01" },
  };
  const requirementTips = ids(inLanguage("en", () => landlordTips(overview))).filter((id) => id.startsWith("requirement:"));
  assert.deepEqual(requirementTips, ["requirement:completeDocumentsOnly", "requirement:noPets", "requirement:noSmoking"]);
});

test("a Requirement tip's text and example", () => {
  const tip = inLanguage("en", () => landlordTips(firstVisit())).find(({ id }) => id === "requirement:noPets");
  assert.deepEqual(tip, { id: "requirement:noPets", text: "Say 'no pets' to exclude everyone else.", example: "no pets" });
});

test("the comparison, profile and invitation tips use the two best-ranked applicants' ids", () => {
  const tips = inLanguage("en", () => landlordTips(firstVisit()));
  const byId = Object.fromEntries(tips.map((tip) => [tip.id, tip]));
  assert.deepEqual(byId.whyAbove, { id: "whyAbove", text: "Ask 'why is A-004 above A-011?' to compare two applicants.", example: "why is A-004 above A-011?" });
  assert.deepEqual(byId.tellMore, { id: "tellMore", text: "Ask 'tell me more about A-004'.", example: "tell me more about A-004" });
  assert.deepEqual(byId.markInvited, {
    id: "markInvited",
    text: "Say 'mark A-004 as invited' once you've invited someone to a viewing.",
    example: "mark A-004 as invited",
  });
  assert.deepEqual(byId.memory, { id: "memory", text: "I remember your preferences for your next visit too.", example: null });
});

test("with one ranked applicant there is no comparison tip; with none, no applicant tips at all", () => {
  const one = { ...firstVisit(), ranked: RANKED.slice(0, 1) };
  const oneIds = ids(inLanguage("en", () => landlordTips(one)));
  assert.ok(!oneIds.includes("whyAbove"));
  assert.ok(oneIds.includes("tellMore") && oneIds.includes("markInvited"));
  const none = { ...firstVisit(), ranked: [] };
  const noneIds = ids(inLanguage("en", () => landlordTips(none)));
  for (const id of ["whyAbove", "tellMore", "markInvited"]) assert.ok(!noneIds.includes(id), id);
  assert.equal(noneIds[0], "heaviest");
  assert.equal(noneIds.at(-1), "memory");
});

test("ties for the heaviest go to the first criterion in criteria order; the example is the next", () => {
  const even = { affordability: 0, schufa: 25, documents: 25, credibility: 25, employment: 25, previousLandlord: 0 };
  const overview = { ...firstVisit(), criteria: { ...firstVisit().criteria, activeWeights: even } };
  const [first] = inLanguage("en", () => landlordTips(overview));
  assert.equal(first.example, "give Documents 30% more importance");
  assert.match(first.text, /ranked mostly by SCHUFA;/);
});

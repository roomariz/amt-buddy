import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CRITERIA, rankApplicants } from "../../src/landlord/scorer.js";

// A flat of 60 m² with 2 rooms at 1000 € asking rent.
const LISTING = { livingAreaSqm: 60, rooms: 2, askingRent: 1000 };

const present = { status: "present", reason: null };

// A complete, clean Applicant profile (as readApplicantPool builds it), with `overrides`.
function profile(id, overrides = {}) {
  const { documentCheck, ...rest } = overrides;
  return {
    id,
    householdSize: 2,
    household: { adults: 2, children: 0, childrenUpToSix: 0 },
    netHouseholdIncome: 4000,
    employmentType: "permanent",
    schufaStatus: "clean",
    moveInDate: "2026-11-01",
    pets: false,
    smoking: false,
    credibilityScore: 100,
    documentCheck: {
      schufa: present,
      incomeProof: present,
      previousLandlord: { ...present, arrears: false },
      complete: true,
      issues: [],
      ...documentCheck,
    },
    ...rest,
  };
}

const rankOne = (applicant, { listing = LISTING, criteria } = {}) =>
  rankApplicants({ profiles: [applicant], listing, criteria }).ranked[0];

const subscore = (applicant, criterion, options) => rankOne(applicant, options).breakdown[criterion].subscore;

test("a complete, clean applicant who can easily afford the rent scores 100", () => {
  const { ranked, excluded } = rankApplicants({ profiles: [profile("A-1")], listing: LISTING });

  assert.equal(excluded.length, 0);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].applicantId, "A-1");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].matchScore, 100);
  assert.equal(ranked[0].rentToIncome, 0.25);
});

test("affordability: full marks at or below 25 % rent-to-income, zero at or above 40 %, linear in between", () => {
  // [net household income, subscore] for 1000 € rent, worked by hand.
  const cases = [
    [5000, 1], // 20 %
    [4000, 1], // 25 %: the upper edge of full marks
    [3200, 0.5833], // 31.25 % → (0.40 - 0.3125) / 0.15
    [3000, 0.4444], // 33.3 % → (0.40 - 0.3333) / 0.15
    [2500, 0], // 40 %: the lower edge of zero
    [2000, 0], // 50 %
  ];
  for (const [income, expected] of cases) {
    assert.equal(subscore(profile("A", { netHouseholdIncome: income }), "affordability"), expected, `income ${income}`);
  }
});

test("schufa: clean 1, minor entries 0.5, negative 0, missing 0", () => {
  for (const [schufaStatus, expected] of [["clean", 1], ["minor_entries", 0.5], ["negative", 0], ["missing", 0]]) {
    assert.equal(subscore(profile("A", { schufaStatus }), "schufa"), expected, schufaStatus);
  }
});

test("documents: the share of required documents present and valid; a first-time renter needs two", () => {
  const missing = { status: "missing", reason: "No SCHUFA-Auskunft." };
  const expired = { status: "expired", reason: "Too old." };
  const inconsistent = { status: "inconsistent", reason: "Another name." };
  const notRequired = { status: "not_required", reason: "First-time renter.", arrears: null };
  const cases = [
    [{}, 1],
    [{ schufa: missing }, 0.6667],
    [{ schufa: expired, incomeProof: inconsistent }, 0.3333],
    [{ schufa: missing, incomeProof: missing, previousLandlord: { ...missing, arrears: null } }, 0],
    [{ previousLandlord: notRequired }, 1],
    [{ previousLandlord: notRequired, schufa: expired }, 0.5],
    // Arrears make the previous-landlord criterion zero, but the document itself is there and valid.
    [{ previousLandlord: { status: "present", reason: "Arrears.", arrears: true } }, 1],
  ];
  for (const [documentCheck, expected] of cases) {
    assert.equal(subscore(profile("A", { documentCheck }), "documents"), expected, JSON.stringify(documentCheck));
  }
});

test("credibility: the Credibility score / 100", () => {
  assert.equal(subscore(profile("A", { credibilityScore: 70 }), "credibility"), 0.7);
  assert.equal(subscore(profile("A", { credibilityScore: 0 }), "credibility"), 0);
});

test("employment: permanent and civil servant 1, fixed-term and self-employed 0.6, student with guarantor 0.5, other 0.3", () => {
  const cases = [
    ["permanent", 1],
    ["civil_servant", 1],
    ["fixed_term", 0.6],
    ["self_employed", 0.6],
    ["student_with_guarantor", 0.5],
    ["other", 0.3],
  ];
  for (const [employmentType, expected] of cases) {
    assert.equal(subscore(profile("A", { employmentType }), "employment"), expected, employmentType);
  }
});

test("previous landlord: no arrears 1, first-time renter 0.5, missing or unusable 0.3, arrears 0", () => {
  const cases = [
    [{ status: "present", reason: null, arrears: false }, 1],
    [{ status: "not_required", reason: "First-time renter.", arrears: null }, 0.5],
    [{ status: "missing", reason: "None.", arrears: null }, 0.3],
    [{ status: "inconsistent", reason: "Another name.", arrears: null }, 0.3],
    [{ status: "present", reason: "Arrears.", arrears: true }, 0],
  ];
  for (const [previousLandlord, expected] of cases) {
    assert.equal(subscore(profile("A", { documentCheck: { previousLandlord } }), "previousLandlord"), expected, previousLandlord.status);
  }
});

// Income 3000 € (33.3 %), minor SCHUFA entries, Credibility 70, fixed-term, first-time renter.
const MIXED = profile("A-mixed", {
  netHouseholdIncome: 3000,
  schufaStatus: "minor_entries",
  credibilityScore: 70,
  employmentType: "fixed_term",
  documentCheck: { previousLandlord: { status: "not_required", reason: "First-time renter.", arrears: null } },
});

test("the Match score is the weighted sum of the subscores under the default weights", () => {
  const entry = rankOne(MIXED);

  // 30 × 0.4444 + 20 × 0.5 + 15 × 1 + 15 × 0.7 + 15 × 0.6 + 5 × 0.5 = 60.33
  assert.equal(entry.matchScore, 60.3);
  assert.deepEqual(
    Object.fromEntries(Object.entries(entry.breakdown).map(([criterion, { weight }]) => [criterion, weight])),
    DEFAULT_CRITERIA.weights,
  );
});

test("weights are relative: any non-negative weights are normalised to sum to 100 %", () => {
  const zero = { affordability: 0, schufa: 0, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 };
  const onlyEmployment = rankOne(MIXED, { criteria: { weights: { ...zero, employment: 7 } } });
  assert.equal(onlyEmployment.matchScore, 60);
  assert.equal(onlyEmployment.breakdown.employment.weight, 100);
  assert.equal(onlyEmployment.breakdown.schufa.weight, 0);

  // 3 : 1 is the same as 75 : 25. 0.75 × 0.5 + 0.25 × 0.7 = 0.55
  const small = rankOne(MIXED, { criteria: { weights: { ...zero, schufa: 3, credibility: 1 } } });
  const large = rankOne(MIXED, { criteria: { weights: { ...zero, schufa: 75, credibility: 25 } } });
  assert.equal(small.matchScore, 55);
  assert.deepEqual(small, large);
  assert.equal(small.breakdown.schufa.weight, 75);
});

test("criteria without weights or requirements use the defaults for what is left out", () => {
  const withDefaults = rankOne(MIXED);
  assert.deepEqual(rankOne(MIXED, { criteria: {} }), withDefaults);
  assert.deepEqual(rankOne(MIXED, { criteria: { weights: { affordability: 30 } } }), withDefaults);
});

test("weights that are negative, not numbers or all zero are refused", () => {
  const zero = { affordability: 0, schufa: 0, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 };
  for (const weights of [{ schufa: -1 }, { schufa: "20" }, { schufa: Number.NaN }, zero]) {
    assert.throws(() => rankApplicants({ profiles: [MIXED], listing: LISTING, criteria: { weights } }), TypeError, JSON.stringify(weights));
  }
});

const excludedOf = (applicant, requirements, listing = LISTING) =>
  rankApplicants({ profiles: [applicant], listing, criteria: { requirements } }).excluded;

test("each Requirement excludes the applicants who fail it, with the reason", () => {
  const cases = [
    [{ schufaCleanOnly: true }, profile("A", { schufaStatus: "minor_entries" }), { requirement: "schufaCleanOnly", schufaStatus: "minor_entries" }],
    [
      { completeDocumentsOnly: true },
      profile("A", { documentCheck: { complete: false, schufa: { status: "expired", reason: "Too old." } } }),
      { requirement: "completeDocumentsOnly", documents: ["schufa"] },
    ],
    [{ maxRentToIncome: 0.33 }, profile("A", { netHouseholdIncome: 2800 }), { requirement: "maxRentToIncome", rentToIncome: 0.3571, limit: 0.33 }],
    [{ noPets: true }, profile("A", { pets: true }), { requirement: "noPets" }],
    [{ noSmoking: true }, profile("A", { smoking: true }), { requirement: "noSmoking" }],
    [
      { latestMoveIn: "2026-10-15" },
      profile("A", { moveInDate: "2026-11-01" }),
      { requirement: "latestMoveIn", moveInDate: "2026-11-01", limit: "2026-10-15" },
    ],
  ];
  for (const [requirements, applicant, reason] of cases) {
    const excluded = excludedOf(applicant, requirements);
    assert.equal(excluded.length, 1, JSON.stringify(requirements));
    assert.equal(excluded[0].applicantId, "A");
    assert.equal(excluded[0].excludedBy, reason.requirement);
    assert.equal(excluded[0].reasons.length, 1);
    const { message, ...values } = excluded[0].reasons[0];
    assert.deepEqual(values, reason);
    assert.equal(typeof message, "string");
    // Without the Requirement the same applicant is ranked.
    assert.equal(rankApplicants({ profiles: [applicant], listing: LISTING }).ranked.length, 1);
  }
});

test("applicants who pass a Requirement stay ranked, at its edge too", () => {
  assert.deepEqual(excludedOf(profile("A", { netHouseholdIncome: 3030.31 }), { maxRentToIncome: 0.33 }), []);
  assert.deepEqual(excludedOf(profile("A", { netHouseholdIncome: 3000 }), { maxRentToIncome: 1 / 3 }), []);
  assert.deepEqual(excludedOf(profile("A", { moveInDate: "2026-10-15" }), { latestMoveIn: "2026-10-15" }), []);
  assert.deepEqual(excludedOf(profile("A", { schufaStatus: "clean" }), { schufaCleanOnly: true }), []);
});

test("an applicant who fails several Requirements lists every reason, the first one excluding", () => {
  const [entry] = excludedOf(profile("A", { pets: true, smoking: true, schufaStatus: "negative" }), {
    schufaCleanOnly: true,
    noPets: true,
    noSmoking: true,
  });
  assert.equal(entry.excludedBy, "schufaCleanOnly");
  assert.deepEqual(entry.reasons.map(({ requirement }) => requirement), ["schufaCleanOnly", "noPets", "noSmoking"]);
});

test("occupancy (on by default): a household too large for the flat under § 7 WoAufG Bln is excluded", () => {
  // 60 m²: 9 m² per person over six, 6 m² per child up to six.
  const sixAdultsOneToddler = profile("A-fits", { householdSize: 7, household: { adults: 6, children: 1, childrenUpToSix: 1 } }); // 60 m²
  const sevenAdults = profile("A-too-many", { householdSize: 7, household: { adults: 6, children: 1, childrenUpToSix: 0 } }); // 63 m²

  const { ranked, excluded } = rankApplicants({ profiles: [sixAdultsOneToddler, sevenAdults], listing: LISTING });

  assert.deepEqual(ranked.map(({ applicantId }) => applicantId), ["A-fits"]);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].applicantId, "A-too-many");
  const { message, ...values } = excluded[0].reasons[0];
  assert.deepEqual(values, { requirement: "occupancyCompliant", householdSize: 7, requiredAreaSqm: 63, livingAreaSqm: 60 });

  const off = rankApplicants({ profiles: [sevenAdults], listing: LISTING, criteria: { requirements: { occupancyCompliant: false } } });
  assert.equal(off.ranked.length, 1);
  assert.equal(off.excluded.length, 0);
});

test("requirements with values of the wrong kind are refused", () => {
  for (const requirements of [{ noPets: "yes" }, { maxRentToIncome: 0 }, { maxRentToIncome: 1.5 }, { latestMoveIn: "soon" }, { occupancyCompliant: null }]) {
    assert.throws(() => excludedOf(profile("A"), requirements), TypeError, JSON.stringify(requirements));
  }
});

test("ranking is by Match score, ties broken by applicant id, the same for any input order", () => {
  const profiles = [
    profile("A-3", { netHouseholdIncome: 3000 }),
    profile("A-2"),
    profile("A-1"),
    profile("A-4", { pets: true, schufaStatus: "negative" }),
  ];
  const first = rankApplicants({ profiles, listing: LISTING });
  const again = rankApplicants({ profiles: [...profiles].reverse(), listing: LISTING });

  assert.deepEqual(first.ranked.map(({ applicantId, rank }) => [applicantId, rank]), [["A-1", 1], ["A-2", 2], ["A-3", 3], ["A-4", 4]]);
  // A-3: 100 - 30 × (1 - 0.4444) = 83.3; A-4: 100 - 20 (negative SCHUFA) = 80.
  assert.deepEqual(first.ranked.slice(2).map(({ matchScore }) => matchScore), [83.3, 80]);
  assert.equal(first.ranked[0].matchScore, first.ranked[1].matchScore);
  assert.deepEqual(again, first);
});

test("excluded applicants are listed by id, and the scorer does not change its input", () => {
  const profiles = [profile("A-2", { pets: true }), profile("A-1", { pets: true }), profile("A-3")];
  const copy = structuredClone(profiles);

  const { excluded } = rankApplicants({ profiles, listing: LISTING, criteria: { requirements: { noPets: true } } });

  assert.deepEqual(excluded.map(({ applicantId }) => applicantId), ["A-1", "A-2"]);
  assert.deepEqual(profiles, copy);
});

// --- Pool stats -------------------------------------------------------------------------------

// A Listing of 60 m² at 1000 € whose Rent check puts the Mietspiegel median at 800 €.
const WITH_RENT_CHECK = { ...LISTING, rentCheck: { range: { lower: 700, median: 800, upper: 950 } } };

// Rent-to-income at 1000 €: A-1 25 %, A-2 33.3 %, A-3 40 %, A-4 20 %, A-5 50 %; at the median
// (800 €): A-3 32 %, A-5 40 %.
const POOL = [
  profile("A-1"),
  profile("A-2", { netHouseholdIncome: 3000, schufaStatus: "minor_entries" }),
  profile("A-3", { netHouseholdIncome: 2500, documentCheck: { complete: false, schufa: { status: "expired", reason: "Too old." } } }),
  profile("A-4", { netHouseholdIncome: 5000, pets: true, schufaStatus: "negative" }),
  profile("A-5", { netHouseholdIncome: 2000, documentCheck: { complete: false } }),
];

test("stats count the whole pool: total, complete documents, can afford, clean SCHUFA, excluded", () => {
  const { stats } = rankApplicants({ profiles: POOL, listing: WITH_RENT_CHECK, criteria: { requirements: { noPets: true } } });

  assert.equal(stats.total, 5);
  assert.equal(stats.completeDocuments, 3); // A-1, A-2, A-4
  assert.equal(stats.canAfford, 3); // at most 1/3: A-1, A-2 (exactly 1/3), A-4
  assert.equal(stats.cleanSchufa, 3); // A-1, A-3, A-5
  assert.equal(stats.excluded, 1); // A-4 has pets
});

test("stats: can afford at the Mietspiegel median shows how far a lower rent widens the pool", () => {
  const { stats } = rankApplicants({ profiles: POOL, listing: WITH_RENT_CHECK });

  assert.equal(stats.medianRent, 800);
  assert.equal(stats.canAfford, 3);
  assert.equal(stats.canAffordAtMedian, 4); // + A-3 (32 %); A-5 stays at 40 %
});

test("stats: 'can afford' follows the maxRentToIncome Requirement when it is set", () => {
  const { stats } = rankApplicants({ profiles: POOL, listing: WITH_RENT_CHECK, criteria: { requirements: { maxRentToIncome: 0.25 } } });

  assert.equal(stats.maxRentToIncome, 0.25);
  assert.equal(stats.canAfford, 2); // A-1 (exactly 25 %), A-4
  assert.equal(stats.canAffordAtMedian, 2); // at 800 €: A-1 20 %, A-4 16 %; A-2 26.7 %
});

test("stats: without a Rent check 'can afford at median' is unavailable (null), not zero", () => {
  const { stats } = rankApplicants({ profiles: POOL, listing: LISTING });

  assert.equal(stats.canAffordAtMedian, null);
  assert.equal(stats.medianRent, null);
  assert.equal(stats.maxRentToIncome, 1 / 3);
  assert.equal(rankApplicants({ profiles: POOL, listing: { ...LISTING, rentCheck: null } }).stats.canAffordAtMedian, null);
});

test("stats of an empty pool are all zero", () => {
  const { stats } = rankApplicants({ profiles: [], listing: WITH_RENT_CHECK });
  assert.deepEqual(
    [stats.total, stats.completeDocuments, stats.canAfford, stats.canAffordAtMedian, stats.cleanSchufa, stats.excluded],
    [0, 0, 0, 0, 0, 0],
  );
});

// --- Recommendations ------------------------------------------------------------------------

const recommendedIds = (result) => result.recommendations.map(({ applicantId }) => applicantId);

test("Recommendations are the top three ranked applicants, never an excluded one", () => {
  const profiles = [
    profile("A-3", { netHouseholdIncome: 3000 }),
    profile("A-1", { pets: true }), // the best score, but excluded
    profile("A-2"),
    profile("A-4", { schufaStatus: "negative" }),
    profile("A-5", { schufaStatus: "negative", netHouseholdIncome: 3000 }), // ranked fourth
  ];
  const result = rankApplicants({ profiles, listing: LISTING, criteria: { requirements: { noPets: true } } });

  assert.deepEqual(recommendedIds(result), ["A-2", "A-3", "A-4"]);
  assert.deepEqual(result.recommendations.map(({ rank }) => rank), [1, 2, 3]);
  assert.deepEqual(result.recommendations.slice(0, 2).map(({ matchScore }) => matchScore), [100, 83.3]);
});

test("fewer Recommendations when fewer applicants qualify", () => {
  const one = rankApplicants({ profiles: [profile("A-1"), profile("A-2", { pets: true })], listing: LISTING, criteria: { requirements: { noPets: true } } });
  assert.deepEqual(recommendedIds(one), ["A-1"]);

  const none = rankApplicants({ profiles: [profile("A-2", { pets: true })], listing: LISTING, criteria: { requirements: { noPets: true } } });
  assert.deepEqual(none.recommendations, []);
});

const recommendationOf = (applicant) => rankApplicants({ profiles: [applicant], listing: LISTING }).recommendations[0];

test("reasons name the three strongest subscores (ties by weight), in German and English", () => {
  const recommendation = recommendationOf(profile("A-1"));

  assert.deepEqual(recommendation.strengths, ["affordability", "schufa", "documents"]);
  assert.equal(recommendation.weakness, null);
  assert.equal(
    recommendation.reason.en,
    "You may like this applicant for their low rent burden (25 % of net household income), clean SCHUFA and complete documents.",
  );
  assert.equal(
    recommendation.reason.de,
    "Dieser Bewerber könnte Ihnen gefallen: geringe Mietbelastung (25 % des Haushaltsnettoeinkommens), saubere SCHUFA und vollständige Unterlagen.",
  );
});

test("reasons mention a notable weakness: the lowest subscore below 0.6, ties by weight", () => {
  // Subscores: affordability 1, documents 1, employment 1, credibility 0.95; SCHUFA 0.5 (weight
  // 20) and previous landlord 0.5 (weight 5).
  const recommendation = recommendationOf(
    profile("A-1", {
      netHouseholdIncome: 5000,
      credibilityScore: 95,
      employmentType: "civil_servant",
      schufaStatus: "minor_entries",
      documentCheck: { previousLandlord: { status: "not_required", reason: "First-time renter.", arrears: null } },
    }),
  );

  assert.deepEqual(recommendation.strengths, ["affordability", "documents", "employment"]);
  assert.equal(recommendation.weakness, "schufa");
  assert.equal(
    recommendation.reason.en,
    "You may like this applicant for their low rent burden (20 % of net household income), complete documents and civil-servant status. To note: minor SCHUFA entries.",
  );
  assert.equal(
    recommendation.reason.de,
    "Dieser Bewerber könnte Ihnen gefallen: geringe Mietbelastung (20 % des Haushaltsnettoeinkommens), vollständige Unterlagen und Beamtenstatus. Zu beachten: kleinere SCHUFA-Einträge.",
  );
});

test("reasons use the applicant's own values, with decimals in each language's style", () => {
  // Rent-to-income 31.25 %: affordability 0.58 is the weakness; credibility 0.88 is not among the top three.
  const recommendation = recommendationOf(profile("A-1", { netHouseholdIncome: 3200, credibilityScore: 88 }));

  assert.deepEqual(recommendation.strengths, ["schufa", "documents", "employment"]);
  assert.equal(recommendation.weakness, "affordability");
  assert.equal(
    recommendation.reason.en,
    "You may like this applicant for their clean SCHUFA, complete documents and permanent job. To note: rent burden of 31.3 % of net household income.",
  );
  assert.equal(
    recommendation.reason.de,
    "Dieser Bewerber könnte Ihnen gefallen: saubere SCHUFA, vollständige Unterlagen und unbefristete Stelle. Zu beachten: Mietbelastung von 31,3 % des Haushaltsnettoeinkommens.",
  );
});

test("reasons with only two strengths, and only strengths of 0.75 or more", () => {
  // Affordability 0 and SCHUFA 0 (weights 30 and 20), documents 0.67, credibility 0.9, employment
  // 0.3, previous landlord 1.
  const recommendation = recommendationOf(
    profile("A-1", {
      netHouseholdIncome: 2500,
      credibilityScore: 90,
      employmentType: "other",
      schufaStatus: "missing",
      documentCheck: { complete: false, schufa: { status: "missing", reason: "No SCHUFA-Auskunft." } },
    }),
  );

  assert.deepEqual(recommendation.strengths, ["previousLandlord", "credibility"]);
  assert.equal(recommendation.weakness, "affordability");
  assert.equal(
    recommendation.reason.en,
    "You may like this applicant for their previous-landlord confirmation without arrears and high credibility (90/100). To note: rent burden of 40 % of net household income.",
  );
  assert.equal(
    recommendation.reason.de,
    "Dieser Bewerber könnte Ihnen gefallen: Vorvermieterbescheinigung ohne Mietrückstände und hohe Glaubwürdigkeit (90/100). Zu beachten: Mietbelastung von 40 % des Haushaltsnettoeinkommens.",
  );
});

test("without a strong subscore the reason falls back to the Match score", () => {
  // Affordability 0, SCHUFA 0, documents 0, credibility 0.5, employment 0.5, previous landlord 0.3:
  // 7.5 + 7.5 + 1.5 = 16.5.
  const missing = { status: "missing", reason: "None." };
  const recommendation = recommendationOf(
    profile("A-1", {
      netHouseholdIncome: 2000,
      credibilityScore: 50,
      employmentType: "student_with_guarantor",
      schufaStatus: "negative",
      documentCheck: { complete: false, schufa: missing, incomeProof: missing, previousLandlord: { ...missing, arrears: null } },
    }),
  );

  assert.deepEqual(recommendation.strengths, []);
  assert.equal(recommendation.weakness, "affordability");
  assert.equal(
    recommendation.reason.en,
    "You may like this applicant for their overall Match score of 16.5. To note: rent burden of 50 % of net household income.",
  );
  assert.equal(
    recommendation.reason.de,
    "Dieser Bewerber könnte Ihnen gefallen: Gesamt-Match-Score von 16,5. Zu beachten: Mietbelastung von 50 % des Haushaltsnettoeinkommens.",
  );
});

test("each criterion's weakness has its own wording in both languages", () => {
  const cases = [
    [{ schufaStatus: "negative" }, "negative SCHUFA entries", "negative SCHUFA-Einträge"],
    [{ schufaStatus: "missing" }, "no usable SCHUFA-Auskunft", "keine verwertbare SCHUFA-Auskunft"],
    [
      { documentCheck: { complete: false, schufa: { status: "expired", reason: "Too old." }, incomeProof: { status: "missing", reason: "None." } } },
      "incomplete documents",
      "unvollständige Unterlagen",
    ],
    [{ credibilityScore: 40 }, "low credibility (40/100)", "geringe Glaubwürdigkeit (40/100)"],
    [{ employmentType: "student_with_guarantor" }, "studies with a guarantor", "Studium mit Bürgschaft"],
    [{ employmentType: "other" }, "no permanent employment", "keine feste Anstellung"],
    [{ documentCheck: { previousLandlord: { status: "missing", reason: "None.", arrears: null } } }, "no previous-landlord confirmation", "keine Vorvermieterbescheinigung"],
    [{ documentCheck: { previousLandlord: { status: "present", reason: "Arrears.", arrears: true } } }, "rent arrears with the previous landlord", "Mietrückstände beim Vorvermieter"],
    [
      { documentCheck: { previousLandlord: { status: "not_required", reason: "First-time renter.", arrears: null } }, credibilityScore: 90 },
      "first flat, no previous landlord",
      "erste Wohnung, kein Vorvermieter",
    ],
  ];
  for (const [overrides, en, de] of cases) {
    const { reason } = recommendationOf(profile("A-1", overrides));
    assert.ok(reason.en.endsWith(` To note: ${en}.`), reason.en);
    assert.ok(reason.de.endsWith(` Zu beachten: ${de}.`), reason.de);
  }
});

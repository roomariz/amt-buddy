// The real landlord Tools (src/landlord/orchestrator/landlord-tools.js) against their shared zod
// contracts, on the committed Applicant pool and an in-memory landlord store.
import test from "node:test";
import assert from "node:assert/strict";

import { APPLICANT_POOL_DIRECTORY, readApplicantPool } from "../../src/landlord/applicant-pool.js";
import { POOL_DATE } from "../../src/landlord/applicant-pool-generator.js";
import { buildListing } from "../../src/landlord/listing.js";
import { createLandlordContext, createLandlordTools, LANDLORD_TOOL_CONTRACTS, LANDLORD_TOOL_NAMES } from "../../src/landlord/orchestrator/index.js";
import { DEFAULT_CRITERIA } from "../../src/landlord/scorer.js";
import { landlordSystemMessage } from "../../src/landlord/orchestrator/prompt.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { errorKind } from "../../src/orchestrator/tool-wrapper.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";

const pool = await readApplicantPool(APPLICANT_POOL_DIRECTORY, { today: POOL_DATE });
const listing = await buildListing(
  { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 60, rooms: 2, askingRent: 900 },
  { fetchImpl: createFakeBerlinWfs().fetchImpl },
);

function setup({ withListing = true, applicantPool = pool } = {}) {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Erika Muster");
  if (withListing) store.saveListing(landlordId, listing);
  const { tools } = createLandlordTools({ getStore: () => store, getApplicantPool: async () => applicantPool, fetchImpl: createFakeBerlinWfs().fetchImpl });
  const byName = new Map(tools.map((candidate) => [candidate.name, candidate]));
  const call = (name, args = {}) => byName.get(name).invoke(args, { configurable: { landlordId } });
  return { store, landlordId, tools, call };
}

const someApplicant = pool.applicants[0].id;

const SAMPLE_ARGS = {
  get_ranking: {},
  get_applicant_profile: { applicantId: someApplicant },
  compare_applicants: { applicantIds: [someApplicant, pool.applicants[1].id] },
  update_selection_criteria: { changes: [{ requirement: "schufaCleanOnly", value: true }] },
  adjust_selection_criteria: { changes: [{ criterion: "employment", by: "factor", value: 2 }] },
  update_flat_details: { facts: [{ fact: "askingRent", value: 950 }] },
  remember_preference: { note: "I'd like someone who stays long-term." },
  update_shortlist: { applicantId: someApplicant, status: "to_invite", note: "Stable income" },
  get_rent_check: {},
  set_bonus_points: { by: "factor", value: 1.3 },
};

test("there is a real Tool for every contract, and each result satisfies its output schema", async () => {
  for (const withListing of [true, false]) {
    const { tools, call } = setup({ withListing });
    assert.deepEqual(tools.map(({ name }) => name).sort(), [...LANDLORD_TOOL_NAMES].sort());
    for (const name of LANDLORD_TOOL_NAMES) {
      const result = await call(name, SAMPLE_ARGS[name]);
      assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS[name].output.parse(result), `${name} (listing: ${withListing})`);
    }
  }
});

test("without a Listing get_ranking still ranks, saying what is inactive; get_rent_check says what it needs", async () => {
  const { call } = setup({ withListing: false });

  const ranking = await call("get_ranking");

  // Occupancy is not evaluated without the size and rooms: nobody is excluded.
  assert.equal(ranking.rankedCount, 40);
  assert.deepEqual(ranking.excludedByReason, {});
  assert.equal(ranking.stats.canAfford, null);
  assert.deepEqual(ranking.inactive, [
    { criterion: "affordability", missing: ["askingRent"] },
    { requirement: "occupancyCompliant", missing: ["livingAreaSqm", "rooms"] },
  ]);
  assert.deepEqual(ranking.ranked[0].breakdown.affordability, { subscore: null, weight: 0 });
  assert.equal(ranking.ranked[0].rentToIncome, null);
  assert.equal(ranking.criteria.weights.affordability, 30, "the saved share, not the active one");

  const rent = await call("get_rent_check");
  assert.equal(rent.rentCheck, null);
  assert.deepEqual(rent.missing, ["address", "livingAreaSqm", "rooms", "askingRent"]);
  assert.match(rent.note, /postal code/);
});

test("without a Listing get_applicant_profile has a rank and score, no rent-to-income, and the inactive items", async () => {
  const { call } = setup({ withListing: false });

  const result = await call("get_applicant_profile", { applicantId: someApplicant });

  assert.equal(typeof result.rank, "number");
  assert.equal(typeof result.matchScore, "number");
  assert.equal(result.rentToIncome, null);
  assert.equal(result.breakdown.affordability.subscore, null);
  assert.deepEqual(result.inactive.map(({ criterion, requirement }) => criterion ?? requirement), ["affordability", "occupancyCompliant"]);
});

test("get_ranking: the top applicants with breakdowns, the stats, exclusions by reason and the Shortlist without notes", async () => {
  const { store, landlordId, call } = setup();
  store.saveCriteria(landlordId, { ...store.getCriteria(landlordId), requirements: { ...store.getCriteria(landlordId).requirements, schufaCleanOnly: true } });
  const { applicantId } = (await call("get_ranking")).ranked[3];
  await call("update_shortlist", { applicantId, status: "invited", note: "Call Mrs. X on Monday" });

  const ranking = await call("get_ranking");

  assert.equal(ranking.ranked.length, 10);
  assert.deepEqual(ranking.ranked.map(({ rank }) => rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ranking.stats.total, 40);
  assert.equal(ranking.rankedCount + ranking.stats.excluded, 40);
  assert.ok(ranking.excludedByReason.schufaCleanOnly > 0);
  assert.deepEqual(ranking.shortlist, [{ applicantId, status: "invited" }]);
  assert.doesNotMatch(JSON.stringify(ranking), /Mrs\. X/);
});

test("adjust_selection_criteria: saves, and returns what was applied, the factor the others were scaled by and the new top 3", async () => {
  const { store, landlordId, call } = setup();

  const result = await call("adjust_selection_criteria", { changes: [{ criterion: "schufa", by: "factor", value: 1.3 }] });

  // The plan's example: SCHUFA 20 → 26, the other five (80) scaled to 74 (74 / 80 = 0.925).
  // requestedChange: the relative change asked for, in % of the old share (26 / 20 − 1 = +30 %), so
  // the chat can say "30 % more" and stay grounded.
  assert.deepEqual(result.applied, [{ criterion: "schufa", from: 20, requested: 26, to: 26, capped: false, requestedChange: 30 }]);
  assert.deepEqual(result.othersScaled, { factor: 0.925, criteria: ["affordability", "documents", "credibility", "employment", "previousLandlord"] });
  assert.deepEqual(result.top.map(({ rank }) => rank), [1, 2, 3]);
  assert.deepEqual(result.inactive, []);
  // The model is not handed the other criteria's shares to recite: the page's chart shows them.
  assert.deepEqual(Object.keys(result).sort(), ["applied", "inactive", "maxShare", "othersScaled", "top"]);
  assert.doesNotMatch(JSON.stringify(result), /"weights"|"requirements"/);
  // Saved unrounded: 30 × 0.925, 15 × 0.925, 5 × 0.925.
  assert.deepEqual(store.getCriteria(landlordId).weights, { affordability: 27.75, schufa: 26, documents: 13.875, credibility: 13.875, employment: 13.875, previousLandlord: 4.625 });
  assert.deepEqual(store.getCriteria(landlordId).requirements, DEFAULT_CRITERIA.requirements);
  // All the new shares, to one decimal, are what get_ranking gives when the landlord asks.
  assert.deepEqual((await call("get_ranking")).criteria.weights, { affordability: 27.8, schufa: 26, documents: 13.9, credibility: 13.9, employment: 13.9, previousLandlord: 4.6 });
  // The limit the chat may mention ("no criterion above 50 %") comes with the result, so it is grounded.
  assert.equal(result.maxShare, 50);
});

test("adjust_selection_criteria reports a capped share, rounded", async () => {
  const { store, landlordId, call } = setup();

  const result = await call("adjust_selection_criteria", { changes: [{ criterion: "affordability", by: "factor", value: 2 }] });

  // 30 × 2 = 60, capped at 50; the other five (70) scaled to 50 (50 / 70 = 0.714…): SCHUFA 14.29,
  // documents 10.71, previous landlord 3.57.
  assert.deepEqual(result.applied, [{ criterion: "affordability", from: 30, requested: 60, to: 50, capped: true, requestedChange: 100 }]);
  assert.deepEqual(result.othersScaled, { factor: 0.714, criteria: ["schufa", "documents", "credibility", "employment", "previousLandlord"] });
  assert.deepEqual((await call("get_ranking")).criteria.weights, { affordability: 50, schufa: 14.3, documents: 10.7, credibility: 10.7, employment: 10.7, previousLandlord: 3.6 });
  const saved = store.getCriteria(landlordId).weights;
  assert.equal(saved.affordability, 50);
  assert.ok(Math.abs(saved.schufa - 100 / 7) < 1e-6, `SCHUFA 20 × 5/7, saved ${saved.schufa}`);
});

test("adjust_selection_criteria: others scaled up (factor above 1), and none left to scale (factor null)", async () => {
  const { call } = setup();

  // Affordability 30 → 15; the other five (70) fill 85: 85 / 70 = 1.214….
  const halved = await call("adjust_selection_criteria", { changes: [{ criterion: "affordability", by: "factor", value: 0.5 }] });
  assert.deepEqual(halved.othersScaled, { factor: 1.214, criteria: ["schufa", "documents", "credibility", "employment", "previousLandlord"] });

  // All six named by share: nothing is scaled.
  const shares = { affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 };
  const all = await call("adjust_selection_criteria", { changes: Object.entries(shares).map(([criterion, value]) => ({ criterion, by: "share", value })) });
  assert.deepEqual(all.othersScaled, { factor: null, criteria: [] });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.adjust_selection_criteria.output.parse(all));
});

test("changing an inactive criterion's weight still saves it, and the result says it is inactive", async () => {
  const { store, landlordId, call } = setup({ withListing: false });

  const result = await call("adjust_selection_criteria", { changes: [{ criterion: "affordability", by: "factor", value: 1.3 }] });

  // 30 → 39; the other five (70) scaled to 61.
  assert.deepEqual(result.applied, [{ criterion: "affordability", from: 30, requested: 39, to: 39, capped: false, requestedChange: 30 }]);
  assert.equal(store.getCriteria(landlordId).weights.affordability, 39);
  assert.deepEqual(result.inactive[0], { criterion: "affordability", missing: ["askingRent"] });
  assert.equal(result.top.length, 3);
});

test("update_selection_criteria changes Requirements only: weights are refused, nothing saved", async () => {
  const { store, landlordId, call } = setup();

  // With valid changes, so the refusal is for the weights and not a missing field.
  await assert.rejects(
    call("update_selection_criteria", { weights: { employment: 50 }, changes: [{ requirement: "noPets", value: true }] }),
    (error) => errorKind(error) === "input" && /Unrecognized key: "weights"/.test(error.message) && !/changes|requirements/.test(error.message),
  );
  assert.deepEqual(store.getCriteria(landlordId), DEFAULT_CRITERIA);

  const result = await call("update_selection_criteria", { changes: [{ requirement: "noPets", value: true }] });
  assert.equal(result.criteria.requirements.noPets, true);
  assert.deepEqual(result.criteria.weights, DEFAULT_CRITERIA.weights);
  assert.equal(result.top.length, 3);
  assert.deepEqual(result.inactive, []);
});

test("update_selection_criteria: a Requirement the contract lets through but the criteria refuse is a Tool input error, nothing saved", async () => {
  const { store, landlordId, call } = setup();

  // The contract takes any value; updateSelectionCriteria checks each (30 February is no date).
  await assert.rejects(
    call("update_selection_criteria", { changes: [{ requirement: "latestMoveIn", value: "2026-02-30" }] }),
    (error) => error.kind === "input" && /requirements\.latestMoveIn/.test(error.message),
  );
  assert.deepEqual(store.getCriteria(landlordId), DEFAULT_CRITERIA);
});

test("update_selection_criteria changes only the Requirements listed; null switches a limit off", async () => {
  const { store, landlordId, call } = setup();
  await call("update_selection_criteria", {
    changes: [{ requirement: "noPets", value: true }, { requirement: "maxRentToIncome", value: 0.35 }, { requirement: "latestMoveIn", value: "2026-11-01" }],
  });

  const result = await call("update_selection_criteria", {
    changes: [{ requirement: "schufaCleanOnly", value: true }, { requirement: "maxRentToIncome", value: null }],
  });

  const expected = { ...DEFAULT_CRITERIA.requirements, noPets: true, schufaCleanOnly: true, maxRentToIncome: null, latestMoveIn: "2026-11-01" };
  assert.deepEqual(result.criteria.requirements, expected);
  assert.deepEqual(store.getCriteria(landlordId).requirements, expected);
});

test("update_selection_criteria refuses a value that does not fit its Requirement, or one listed twice; nothing saved", async () => {
  const { store, landlordId, call } = setup();
  const refused = [
    [{ requirement: "noPets", value: null }],
    [{ requirement: "schufaCleanOnly", value: "yes" }],
    [{ requirement: "maxRentToIncome", value: 1.5 }],
    [{ requirement: "maxRentToIncome", value: true }],
    [{ requirement: "latestMoveIn", value: 20261101 }],
    [{ requirement: "noPets", value: true }, { requirement: "noPets", value: false }],
  ];

  for (const changes of refused) {
    await assert.rejects(call("update_selection_criteria", { changes }), (error) => error.kind === "input", JSON.stringify(changes));
  }
  assert.deepEqual(store.getCriteria(landlordId), DEFAULT_CRITERIA);
});

test("adjust_selection_criteria and update_shortlist refuse invalid input as input errors, saving nothing", async () => {
  const { store, landlordId, call } = setup();
  const ignore = ["schufa", "documents", "credibility", "employment"].map((criterion) => ({ criterion, by: "factor", value: 0 }));

  // Affordability would fill 85.7 %.
  await assert.rejects(call("adjust_selection_criteria", { changes: ignore }), (error) => error.kind === "input" && /50 % limit/.test(error.message));
  await assert.rejects(call("update_shortlist", { applicantId: "A-999", status: "to_invite", note: null }), (error) => error.kind === "input");
  assert.deepEqual(store.getCriteria(landlordId), DEFAULT_CRITERIA);
  assert.deepEqual(store.getShortlist(landlordId), []);
});

test("update_flat_details saves what it is given and, with all four facts, builds the Listing with its Rent check", async () => {
  const { store, landlordId, call } = setup({ withListing: false });

  const partial = await call("update_flat_details", { facts: [{ fact: "askingRent", value: 700 }, { fact: "rooms", value: 2 }] });

  assert.deepEqual(partial.flat, { address: null, livingAreaSqm: null, rooms: 2, askingRent: 700, buildingYear: null });
  assert.deepEqual(partial.missing, ["address", "livingAreaSqm"]);
  assert.equal(partial.listing, null);
  assert.equal(partial.rentCheck, null);
  assert.match(partial.note, /address, livingAreaSqm/);
  assert.deepEqual(partial.inactive, [{ requirement: "occupancyCompliant", missing: ["livingAreaSqm"] }]);
  assert.equal(typeof partial.stats.canAfford, "number");
  assert.equal(partial.top.length, 3);
  assert.equal(store.getListing(landlordId), null);

  const full = await call("update_flat_details", { facts: [{ fact: "address", value: "Wühlischstraße 30, 10245 Berlin" }, { fact: "livingAreaSqm", value: 50 }] });

  // Wühlischstraße 30 (fake WFS), 50 m²: Mietspiegel + 10 % = 539 €.
  assert.deepEqual(full.missing, []);
  assert.equal(full.listing.addressVerified, true);
  assert.equal(full.listing.canonicalAddress.postalCode, "10245");
  assert.equal(full.rentCheck.allowedRent, 539);
  assert.equal(full.note, null);
  assert.deepEqual(full.inactive, []);
  assert.equal(full.stats.medianRent, 490);
  assert.equal(store.getListing(landlordId).rentCheck.allowedRent, 539);
});

test("update_flat_details: a value the Listing form refuses is an input error, nothing saved; an unknown address a note", async () => {
  const { store, landlordId, call } = setup({ withListing: false });

  await assert.rejects(
    call("update_flat_details", { facts: [{ fact: "address", value: "Wühlischstraße 30" }, { fact: "askingRent", value: 700 }] }),
    (error) => error.kind === "input" && /postal code/.test(error.message) && /Nothing was saved/.test(error.message),
  );
  assert.equal(store.getFlatDetails(landlordId).askingRent, null);

  const unknown = await call("update_flat_details", { facts: [{ fact: "address", value: "Erfundene Straße 1, 10245 Berlin" }, { fact: "livingAreaSqm", value: 50 }, { fact: "rooms", value: 2 }, { fact: "askingRent", value: 700 }] });
  assert.equal(unknown.rentCheck, null);
  assert.match(unknown.note, /address register has no such address/);
  assert.equal(store.getFlatDetails(landlordId).askingRent, 700);
});

test("update_flat_details: the refusal names the field and says its message once", async () => {
  const { call } = setup({ withListing: false });

  await assert.rejects(call("update_flat_details", { facts: [{ fact: "address", value: "Wühlischstraße 30" }] }), (error) => {
    assert.equal(
      error.message,
      "address: The address needs street, house number and postal code, e.g. 'Wühlischstraße 30, 10245 Berlin'. " +
        "Nothing was saved: call again without that value to save the others.",
    );
    return true;
  });
});

test("update_flat_details saves only the facts listed: an unstated building year stays unknown", async () => {
  const { store, landlordId, call } = setup({ withListing: false });

  const result = await call("update_flat_details", { facts: [{ fact: "askingRent", value: 700 }] });

  assert.deepEqual(result.flat, { address: null, livingAreaSqm: null, rooms: null, askingRent: 700, buildingYear: null });
  assert.deepEqual(store.getFlatDetails(landlordId), result.flat);
});

test("update_flat_details: a fact listed twice is an input error, nothing saved", async () => {
  const { store, landlordId, call } = setup({ withListing: false });

  await assert.rejects(
    call("update_flat_details", { facts: [{ fact: "rooms", value: 2 }, { fact: "askingRent", value: 700 }, { fact: "rooms", value: 3 }] }),
    (error) => error.kind === "input" && /'rooms'/.test(error.message),
  );
  assert.deepEqual(store.getFlatDetails(landlordId), { address: null, livingAreaSqm: null, rooms: null, askingRent: null, buildingYear: null });
});

test("get_applicant_profile: an excluded applicant comes with the Requirement and its reasons; an unknown id is an input error", async () => {
  const { store, landlordId, call } = setup();
  store.saveCriteria(landlordId, { ...store.getCriteria(landlordId), requirements: { ...store.getCriteria(landlordId).requirements, schufaCleanOnly: true } });
  const excluded = pool.applicants.find(({ profile }) => profile.schufaStatus !== "clean").id;

  const result = await call("get_applicant_profile", { applicantId: excluded });

  assert.equal(result.matchScore, null);
  assert.equal(result.excludedBy, "schufaCleanOnly");
  assert.match(result.exclusionReasons[0].message, /not clean/);
  await assert.rejects(call("get_applicant_profile", { applicantId: "A-999" }), (error) => error.kind === "input");
});

test("get_applicant_profile: each criterion's contribution is subscore × weight in points, to one decimal", async () => {
  // A constructed applicant for the Listing (asking rent 900, 60 m², 2 rooms) under the default weights.
  const present = { status: "present", reason: null };
  const profile = {
    ...pool.applicants[0].profile,
    id: "A-100",
    householdSize: 2,
    household: { adults: 2, children: 0, childrenUpToSix: 0 },
    netHouseholdIncome: 3000,
    employmentType: "fixed_term",
    schufaStatus: "clean",
    credibilityScore: 85,
    documentCheck: { schufa: present, incomeProof: present, previousLandlord: { status: "not_required", reason: null, arrears: null }, complete: true, issues: [] },
  };
  const { call } = setup({ applicantPool: { applicants: [{ id: "A-100", profile }], errors: [] } });

  const result = await call("get_applicant_profile", { applicantId: "A-100" });

  // Affordability: 900 / 3000 = 0.3, (0.4 − 0.3) / 0.15 = 0.6667 × 30 = 20.0; SCHUFA clean 1 × 20;
  // documents 2 of 2 × 15; credibility 0.85 × 15 = 12.75 → 12.8; fixed-term 0.6 × 15 = 9;
  // first-time renter 0.5 × 5 = 2.5.
  assert.deepEqual(result.contributions, { affordability: 20, schufa: 20, documents: 15, credibility: 12.8, employment: 9, previousLandlord: 2.5 });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.get_applicant_profile.output.parse(result));
});

test("get_applicant_profile: the contributions sum to the Match score; inactive ones are null, an excluded applicant has none", async () => {
  for (const withListing of [true, false]) {
    const { call } = setup({ withListing });
    const { ranked } = await call("get_ranking");
    for (const { applicantId } of ranked) {
      const { contributions, matchScore } = await call("get_applicant_profile", { applicantId });
      const values = Object.values(contributions);
      assert.equal(values.length, 6);
      const sum = values.reduce((total, points) => total + (points ?? 0), 0);
      assert.ok(Math.abs(sum - matchScore) <= 0.1 * values.length, `${applicantId}: ${sum} against ${matchScore}`);
      assert.equal(contributions.affordability === null, !withListing, `${applicantId}: affordability is inactive without an asking rent`);
    }
  }
  const { store, landlordId, call } = setup();
  store.saveCriteria(landlordId, { ...store.getCriteria(landlordId), requirements: { ...store.getCriteria(landlordId).requirements, schufaCleanOnly: true } });
  const excluded = pool.applicants.find(({ profile }) => profile.schufaStatus !== "clean").id;
  assert.equal((await call("get_applicant_profile", { applicantId: excluded })).contributions, null);
});

// Two constructed applicants for compare_applicants, households of 2 (the Listing's 60 m², 2 rooms
// fit them). A-100: net income 3000, fixed-term, clean SCHUFA, credibility 80, first-time renter.
// A-101: net income 4500, self-employed, negative SCHUFA, credibility 90, previous landlord confirmed
// without arrears.
function comparedPair(changes = {}) {
  const present = { status: "present", reason: null };
  const base = { ...pool.applicants[0].profile, householdSize: 2, household: { adults: 2, children: 0, childrenUpToSix: 0 } };
  const documents = (previousLandlord) => ({ schufa: present, incomeProof: present, previousLandlord, complete: true, issues: [] });
  const profiles = [
    { ...base, id: "A-100", netHouseholdIncome: 3000, employmentType: "fixed_term", schufaStatus: "clean", credibilityScore: 80, documentCheck: documents({ status: "not_required", reason: null, arrears: null }) },
    { ...base, id: "A-101", netHouseholdIncome: 4500, employmentType: "self_employed", schufaStatus: "negative", credibilityScore: 90, documentCheck: documents({ ...present, arrears: false }) },
  ].map((profile) => ({ ...profile, ...changes[profile.id] }));
  return { applicants: profiles.map((profile) => ({ id: profile.id, profile })), errors: [] };
}

test("compare_applicants: per criterion both applicants' points and their difference, largest first; equal criteria apart", async () => {
  const { call } = setup({ applicantPool: comparedPair() });

  const result = await call("compare_applicants", { applicantIds: ["A-101", "A-100"] });

  // Asking rent 900, default weights. A-100: affordability 900 / 3000 = 0.3 → (0.4 − 0.3) / 0.15 ×
  // 30 = 20, SCHUFA 20, documents 2 of 2 × 15 = 15, credibility 0.8 × 15 = 12, fixed-term 0.6 × 15 =
  // 9, first-time renter 0.5 × 5 = 2.5: 78.5. A-101: 900 / 4500 = 0.2 → 30, negative SCHUFA 0,
  // documents 3 of 3 × 15 = 15, 0.9 × 15 = 13.5, self-employed 0.6 × 15 = 9, confirmed 5: 72.5.
  // Differences are A-101's points minus A-100's; affordability favours the lower-ranked A-101.
  assert.deepEqual(result, {
    applicants: [
      { applicantId: "A-101", rank: 2, matchScore: 72.5, excludedBy: null },
      { applicantId: "A-100", rank: 1, matchScore: 78.5, excludedBy: null },
    ],
    leader: "A-100",
    scoreGap: -6,
    differences: [
      { criterion: "schufa", points: { "A-101": 0, "A-100": 20 }, difference: -20 },
      { criterion: "affordability", points: { "A-101": 30, "A-100": 20 }, difference: 10 },
      { criterion: "previousLandlord", points: { "A-101": 5, "A-100": 2.5 }, difference: 2.5 },
      { criterion: "credibility", points: { "A-101": 13.5, "A-100": 12 }, difference: 1.5 },
    ],
    equal: ["documents", "employment"],
    note: null,
  });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.compare_applicants.output.parse(result));
});

test("compare_applicants: equal Match scores have no leader and say they are ordered by applicant id", async () => {
  // A-101 as A-100 in every scored respect.
  const same = { netHouseholdIncome: 3000, employmentType: "fixed_term", schufaStatus: "clean", credibilityScore: 80 };
  const pair = comparedPair({ "A-101": same });
  pair.applicants[1].profile.documentCheck = pair.applicants[0].profile.documentCheck;
  const { call } = setup({ applicantPool: pair });

  const result = await call("compare_applicants", { applicantIds: ["A-100", "A-101"] });

  assert.equal(result.leader, null);
  assert.equal(result.scoreGap, 0);
  assert.equal(result.note, "equal Match scores; ordered by applicant id");
  assert.deepEqual(result.differences, []);
  assert.deepEqual(result.equal, ["affordability", "schufa", "documents", "credibility", "employment", "previousLandlord"]);
  assert.deepEqual(result.applicants.map(({ rank, matchScore }) => ({ rank, matchScore })), [{ rank: 1, matchScore: 78.5 }, { rank: 2, matchScore: 78.5 }]);
});

test("compare_applicants: an excluded applicant has no points to compare; the note says which Requirement", async () => {
  const { store, landlordId, call } = setup({ applicantPool: comparedPair() });
  store.saveCriteria(landlordId, { ...store.getCriteria(landlordId), requirements: { ...store.getCriteria(landlordId).requirements, schufaCleanOnly: true } });

  const result = await call("compare_applicants", { applicantIds: ["A-100", "A-101"] });

  assert.deepEqual(result, {
    applicants: [
      { applicantId: "A-100", rank: 1, matchScore: 78.5, excludedBy: null },
      { applicantId: "A-101", rank: null, matchScore: null, excludedBy: "schufaCleanOnly" },
    ],
    leader: null,
    scoreGap: null,
    differences: [],
    equal: [],
    note: "A-101 is excluded by the Requirement schufaCleanOnly: an excluded applicant has no Match score, so there are no points to compare.",
  });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.compare_applicants.output.parse(result));
});

test("compare_applicants: an inactive criterion is in neither the differences nor the equal ones", async () => {
  const { call } = setup({ withListing: false, applicantPool: comparedPair() });

  const result = await call("compare_applicants", { applicantIds: ["A-101", "A-100"] });

  // No asking rent: affordability is off, the other five share 100 % (SCHUFA 28.57, credibility
  // 21.43, previous landlord 7.14). SCHUFA 0 against 28.6; previous landlord 7.1 against 3.6 (3.5);
  // credibility 19.3 against 17.1 (2.2).
  assert.deepEqual(result.differences.map(({ criterion, difference }) => ({ criterion, difference })), [
    { criterion: "schufa", difference: -28.6 },
    { criterion: "previousLandlord", difference: 3.5 },
    { criterion: "credibility", difference: 2.2 },
  ]);
  assert.deepEqual(result.equal, ["documents", "employment"]);
});

test("compare_applicants refuses an unknown id, the same id twice, or other than two ids, as input errors", async () => {
  const { call } = setup({ applicantPool: comparedPair() });

  const refused = [["A-100", "A-999"], ["A-100", "A-100"], ["A-100"], ["A-100", "A-101", "A-100"]];
  for (const applicantIds of refused) {
    await assert.rejects(call("compare_applicants", { applicantIds }), (error) => errorKind(error) === "input", JSON.stringify(applicantIds));
  }
  await assert.rejects(call("compare_applicants", { applicantIds: ["A-100", "A-999"] }), /no applicant 'A-999'/);
});

test("update_shortlist never hands the landlord's earlier note back to the model", async () => {
  const { store, landlordId, call } = setup();
  store.saveShortlistEntry(landlordId, { applicantId: someApplicant, status: "to_invite", note: "Call Mrs. X on Monday" });

  const changed = await call("update_shortlist", { applicantId: someApplicant, status: "invited", note: null });

  assert.deepEqual(changed, { applicantId: someApplicant, status: "invited", note: null });
  assert.equal(store.getShortlist(landlordId)[0].note, "Call Mrs. X on Monday", "the note is kept");
  assert.equal((await call("update_shortlist", { applicantId: someApplicant, status: "invited", note: "Viewing Friday" })).note, "Viewing Friday");
});

test("update_shortlist: a note of null or blank keeps the landlord's note (the chat never clears one)", async () => {
  const { store, landlordId, call } = setup();
  store.saveShortlistEntry(landlordId, { applicantId: someApplicant, status: "to_invite", note: "Call Mrs. X on Monday" });

  for (const note of [null, "", "   "]) {
    const changed = await call("update_shortlist", { applicantId: someApplicant, status: "invited", note });
    assert.equal(changed.note, null, JSON.stringify(note));
    assert.equal(store.getShortlist(landlordId)[0].note, "Call Mrs. X on Monday", JSON.stringify(note));
  }
});

test("remember_preference stores the note for this landlord only; the context shows it with the saved criteria", async () => {
  const { store, landlordId, call } = setup();
  const other = store.signIn("Max Mustermann").landlordId;
  const getContext = createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool });

  const first = await call("remember_preference", { note: "  Wants someone who stays long-term.  " });
  const second = await call("remember_preference", { note: "No students, please." });

  assert.equal(first.note, "Wants someone who stays long-term.");
  assert.notEqual(first.noteId, second.noteId);
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.remember_preference.output.parse(first));
  const context = await getContext(landlordId);
  assert.deepEqual(context.preferences.notes.map(({ note }) => note), ["Wants someone who stays long-term.", "No students, please."]);
  assert.deepEqual(context.preferences.criteria, store.getCriteria(landlordId));
  assert.deepEqual((await getContext(other)).preferences.notes, []);

  // Saved criteria, as the chat can quote them: weights to one decimal (SCHUFA 26 %, affordability 27.75 → 27.8 %).
  await call("adjust_selection_criteria", { changes: [{ criterion: "schufa", by: "factor", value: 1.3 }] });
  const { weights } = (await getContext(landlordId)).preferences.criteria;
  assert.equal(weights.schufa, 26);
  assert.equal(weights.affordability, 27.8);
});

test("the context carries the top 5 of the ranking: id, rank, Match score and rent-to-income only", async () => {
  // No flat details: ranked anyway, no asking rent, so no ratio.
  {
    const { store, landlordId, call } = setup({ withListing: false });
    const { top } = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);
    assert.equal(top.length, 5);
    assert.deepEqual(top.map(({ rank }) => rank), [1, 2, 3, 4, 5]);
    for (const entry of top) {
      assert.deepEqual(Object.keys(entry).sort(), ["applicantId", "matchScore", "rank", "rentToIncome"], "no breakdown, name or contact");
      assert.equal(entry.rentToIncome, null);
    }
    const { ranked } = await call("get_ranking");
    assert.deepEqual(top.map(({ applicantId, matchScore }) => ({ applicantId, matchScore })), ranked.slice(0, 5).map(({ applicantId, matchScore }) => ({ applicantId, matchScore })), "the ranking get_ranking gives");
  }
  // The Listing's asking rent of 900: rent / net household income, to four decimals as get_ranking gives it.
  {
    const { store, landlordId, call } = setup();
    const { top } = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);
    const incomeOf = new Map(pool.applicants.map(({ id, profile }) => [id, profile.netHouseholdIncome]));
    assert.equal(top.length, 5);
    for (const { applicantId, rentToIncome } of top) assert.equal(rentToIncome, Math.round((900 / incomeOf.get(applicantId)) * 10000) / 10000, applicantId);
    const { ranked } = await call("get_ranking");
    assert.deepEqual(top, ranked.slice(0, 5).map(({ applicantId, rank, matchScore, rentToIncome }) => ({ applicantId, rank, matchScore, rentToIncome })));
  }
});

test("the context's Shortlist has ids and statuses only; the system prompt shows it and the top, never a note", async () => {
  const { store, landlordId } = setup();
  store.saveShortlistEntry(landlordId, { applicantId: someApplicant, status: "to_invite", note: "Call Mrs. X on Monday" });

  const context = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);

  assert.deepEqual(context.shortlist, [{ applicantId: someApplicant, status: "to_invite" }]);
  assert.ok(!JSON.stringify(context).includes("Mrs. X"), "the note is not in the context");
  const system = landlordSystemMessage({ context, language: "en" }).content;
  assert.ok(!system.includes("Mrs. X"), "the note is not in the system prompt");
  assert.ok(system.includes(`Shortlist:\n${JSON.stringify([{ applicantId: someApplicant, status: "to_invite" }])}`));
  assert.ok(system.includes(`Top of the current ranking:\n${JSON.stringify(context.top)}`));
  assert.match(system, /current as of this turn/);
});

test("the system prompt explains the pool stats fields and when a share may be called capped", async () => {
  const { store, landlordId } = setup();
  const context = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);

  const system = landlordSystemMessage({ context, language: "en" }).content;

  assert.ok(system.includes(`Applicant pool statistics:\n${JSON.stringify(context.stats)}\nTheir fields:`));
  for (const field of ["total", "completeDocuments", "canAfford", "cleanSchufa", "excluded", "maxRentToIncome"]) assert.match(system, new RegExp(`\\b${field} = `), field);
  assert.match(system, /canAffordAtMedian = how many could afford the Mietspiegel median rent "medianRent"/);
  assert.match(system, /canAfford = how many can afford the asking rent/);
  assert.match(system, /capped only for a change whose "capped" is true/);
  assert.match(system, /After a weight change report the "applied" entries of the result.*"SCHUFA 20 → 26 %".*other criteria were scaled proportionally \("othersScaled"\)/);
  // One rule for every turn, not only weight changes: the page's chart shows all the weights.
  assert.match(system, /The landlord's page always shows all Selection-criteria weights in a chart\. Never list the weights\. Mention a weight only when a tool call of this turn changed it \(old → new, from the result; never repeat a change from an earlier turn\) or when the landlord asks about that criterion \(then its share only, without the others' for comparison\)\. Only adjust_selection_criteria changes weights: saving flat details, Requirements or bonus points, or a criterion becoming active, changes none, so do not mention weights then\. If the landlord asks for all weights, point to the chart and give them only if they insist \(then call get_ranking/);
  assert.match(system, /call compare_applicants and go through its "differences" in order: say which criteria favour which applicant and by how many points, including those that favour the lower-ranked one; call criteria equal only if they are in "equal"/);
});

test("a whitespace-only note is an input error and nothing is stored", async () => {
  const { landlordId, store, call } = setup({ withListing: false });
  const getContext = createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool });
  await assert.rejects(call("remember_preference", { note: "   " }), (error) => error.kind === "input");
  const context = await getContext(landlordId);
  assert.equal(context.listing, null);
  assert.deepEqual(context.preferences.notes, []);
});

// The landlord's thumbs up / down (Round 2, decision 6), as the model sees them: ids with the bonus
// in points and the ranking score (Match score + bonus), computed in code; never "up" or "down".
test("set_bonus_points: by factor or points, saved to one decimal, capped at 20, with the new top 3", async () => {
  const { store, landlordId, call } = setup();

  // 5 × 1.3 = 6.5.
  const raised = await call("set_bonus_points", { by: "factor", value: 1.3 });
  assert.deepEqual(
    { previous: raised.previous, bonusPoints: raised.bonusPoints, requested: raised.requested, capped: raised.capped, maxBonusPoints: raised.maxBonusPoints },
    { previous: 5, bonusPoints: 6.5, requested: 6.5, capped: false, maxBonusPoints: 20 },
  );
  assert.deepEqual(raised.top.map(({ rank }) => rank), [1, 2, 3]);
  assert.equal(store.getBonusPoints(landlordId), 6.5);
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.set_bonus_points.output.parse(raised));

  const capped = await call("set_bonus_points", { by: "points", value: 30 });
  assert.deepEqual({ previous: capped.previous, bonusPoints: capped.bonusPoints, requested: capped.requested, capped: capped.capped }, { previous: 6.5, bonusPoints: 20, requested: 30, capped: true });
  assert.equal(store.getBonusPoints(landlordId), 20);
});

test("set_bonus_points refuses negative points, a negative factor or another kind of change as input errors, nothing saved", async () => {
  const { store, landlordId, call } = setup();
  for (const args of [{ by: "points", value: -1 }, { by: "factor", value: -0.5 }, { by: "share", value: 2 }, { by: "points" }]) {
    await assert.rejects(call("set_bonus_points", args), (error) => errorKind(error) === "input", JSON.stringify(args));
  }
  assert.equal(store.getBonusPoints(landlordId), 5);
});

test("set_bonus_points' new top is ranked by Match score + the new bonus", async () => {
  const { store, landlordId, call } = setup();
  const { ranked } = await call("get_ranking");
  // The fourth applicant, rated up: with 20 points they pass everyone less than 20 points above them.
  const rated = ranked[3];
  store.setRating(landlordId, rated.applicantId, 1);

  const { top } = await call("set_bonus_points", { by: "points", value: 20 });

  const expectedRank = ranked.filter(({ applicantId, matchScore }) => applicantId !== rated.applicantId && matchScore > rated.matchScore + 20).length + 1;
  assert.equal(top.findIndex(({ applicantId }) => applicantId === rated.applicantId) + 1, expectedRank);
  const entry = top.find(({ applicantId }) => applicantId === rated.applicantId);
  assert.deepEqual({ matchScore: entry.matchScore, bonus: entry.bonus, rankingScore: entry.rankingScore }, { matchScore: rated.matchScore, bonus: 20, rankingScore: Math.round((rated.matchScore + 20) * 10) / 10 });
});

test("get_ranking and get_applicant_profile carry the bonus: points and ranking score by id, the bonus points in force", async () => {
  const { store, landlordId, call } = setup();
  const before = await call("get_ranking");
  const [first, second] = before.ranked;
  store.setRating(landlordId, first.applicantId, -1);
  store.setRating(landlordId, second.applicantId, 1);
  store.saveBonusPoints(landlordId, 4);

  const ranking = await call("get_ranking");

  assert.equal(ranking.bonusPoints, 4);
  const down = ranking.ranked.find(({ applicantId }) => applicantId === first.applicantId);
  const up = ranking.ranked.find(({ applicantId }) => applicantId === second.applicantId);
  assert.deepEqual({ bonus: down.bonus, rankingScore: down.rankingScore }, { bonus: -4, rankingScore: Math.round((first.matchScore - 4) * 10) / 10 });
  assert.deepEqual({ bonus: up.bonus, rankingScore: up.rankingScore }, { bonus: 4, rankingScore: Math.round((second.matchScore + 4) * 10) / 10 });
  const unrated = ranking.ranked.find(({ applicantId }) => ![first.applicantId, second.applicantId].includes(applicantId));
  assert.ok(!("bonus" in unrated) && !("rankingScore" in unrated), "an unrated entry keeps its shape");
  assert.doesNotMatch(JSON.stringify(ranking), /"rating"|"up"|"down"/);

  const profile = await call("get_applicant_profile", { applicantId: second.applicantId });
  assert.deepEqual({ rank: profile.rank, matchScore: profile.matchScore, bonus: profile.bonus, rankingScore: profile.rankingScore }, { rank: up.rank, matchScore: second.matchScore, bonus: 4, rankingScore: up.rankingScore });
  const plain = await call("get_applicant_profile", { applicantId: unrated.applicantId });
  assert.deepEqual({ bonus: plain.bonus, rankingScore: plain.rankingScore }, { bonus: 0, rankingScore: unrated.matchScore });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.get_applicant_profile.output.parse(profile));
});

test("get_applicant_profile: an excluded applicant has no bonus or ranking score, rated or not", async () => {
  const { store, landlordId, call } = setup();
  store.saveCriteria(landlordId, { ...store.getCriteria(landlordId), requirements: { ...store.getCriteria(landlordId).requirements, schufaCleanOnly: true } });
  const excluded = pool.applicants.find(({ profile }) => profile.schufaStatus !== "clean").id;
  store.setRating(landlordId, excluded, 1);

  const result = await call("get_applicant_profile", { applicantId: excluded });

  assert.deepEqual({ bonus: result.bonus, rankingScore: result.rankingScore, excludedBy: result.excludedBy }, { bonus: null, rankingScore: null, excludedBy: "schufaCleanOnly" });
});

test("compare_applicants with a rating: the leader by Match score + bonus, the bonus its own difference, both gaps", async () => {
  const { store, landlordId, call } = setup({ applicantPool: comparedPair() });
  // A-100 78.5, A-101 72.5 (see the unrated comparison); A-101 rated up with 10 points: 82.5.
  store.setRating(landlordId, "A-101", 1);
  store.saveBonusPoints(landlordId, 10);

  const result = await call("compare_applicants", { applicantIds: ["A-101", "A-100"] });

  assert.deepEqual(result, {
    applicants: [
      { applicantId: "A-101", rank: 1, matchScore: 72.5, excludedBy: null, bonus: 10, rankingScore: 82.5 },
      { applicantId: "A-100", rank: 2, matchScore: 78.5, excludedBy: null, bonus: 0, rankingScore: 78.5 },
    ],
    leader: "A-101",
    scoreGap: -6,
    rankingGap: 4,
    differences: [
      { criterion: "schufa", points: { "A-101": 0, "A-100": 20 }, difference: -20 },
      { criterion: "affordability", points: { "A-101": 30, "A-100": 20 }, difference: 10 },
      { criterion: "bonus", points: { "A-101": 10, "A-100": 0 }, difference: 10 },
      { criterion: "previousLandlord", points: { "A-101": 5, "A-100": 2.5 }, difference: 2.5 },
      { criterion: "credibility", points: { "A-101": 13.5, "A-100": 12 }, difference: 1.5 },
    ],
    equal: ["documents", "employment"],
    note: null,
  });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.compare_applicants.output.parse(result));
});

test("compare_applicants: equal bonuses are listed as equal; equal ranking scores have no leader and say why", async () => {
  {
    const { store, landlordId, call } = setup({ applicantPool: comparedPair() });
    store.setRating(landlordId, "A-100", -1);
    store.setRating(landlordId, "A-101", -1);

    const result = await call("compare_applicants", { applicantIds: ["A-100", "A-101"] });

    // 78.5 − 5 = 73.5 against 72.5 − 5 = 67.5.
    assert.equal(result.leader, "A-100");
    assert.equal(result.rankingGap, 6);
    assert.deepEqual(result.equal, ["documents", "employment", "bonus"]);
    assert.ok(!result.differences.some(({ criterion }) => criterion === "bonus"));
    assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.compare_applicants.output.parse(result));
  }
  {
    const { store, landlordId, call } = setup({ applicantPool: comparedPair() });
    // A-101 72.5 + 6 = 78.5, as A-100's unrated 78.5.
    store.setRating(landlordId, "A-101", 1);
    store.saveBonusPoints(landlordId, 6);

    const result = await call("compare_applicants", { applicantIds: ["A-100", "A-101"] });

    assert.equal(result.leader, null);
    assert.equal(result.rankingGap, 0);
    assert.equal(result.scoreGap, 6);
    assert.equal(result.note, "equal ranking scores (Match score + bonus); ordered by applicant id");
  }
});

test("the context's top 5 carries a rated applicant's bonus and ranking score; the system prompt shows the bonus points", async () => {
  const { store, landlordId, call } = setup();
  const { ranked } = await call("get_ranking");
  store.setRating(landlordId, ranked[1].applicantId, 1);
  store.saveBonusPoints(landlordId, 7);

  const context = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);

  assert.equal(context.bonusPoints, 7);
  const rated = context.top.find(({ applicantId }) => applicantId === ranked[1].applicantId);
  assert.deepEqual(Object.keys(rated).sort(), ["applicantId", "bonus", "matchScore", "rank", "rankingScore", "rentToIncome"]);
  assert.deepEqual({ bonus: rated.bonus, rankingScore: rated.rankingScore }, { bonus: 7, rankingScore: Math.round((ranked[1].matchScore + 7) * 10) / 10 });
  const expectedRank = ranked.filter(({ applicantId, matchScore }) => applicantId !== rated.applicantId && matchScore > ranked[1].matchScore + 7).length + 1;
  assert.equal(rated.rank, expectedRank, "7 points pass everyone less than 7 points above");
  const system = landlordSystemMessage({ context, language: "en" }).content;
  assert.match(system, /thumbs up or down is worth 7 bonus points/);
  assert.doesNotMatch(JSON.stringify(context), /"rating"/);
});

test("the system prompt explains the bonus, set_bonus_points for 'more weight to my impression', and that the chat cannot rate", async () => {
  const { store, landlordId } = setup();
  const context = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);

  const system = landlordSystemMessage({ context, language: "en" }).content;

  assert.match(system, /Match score stays objective/);
  assert.match(system, /set_bonus_points/);
  assert.match(system, /× 1\.3/);
  assert.match(system, /cannot rate applicants/);
  assert.match(system, /never suggest a thumbs up or down on protected grounds/i);
  assert.match(system, /look at who is rated now .*never assume nobody is rated/);
});

test("the system prompt keeps the Mietspiegel range apart from the allowed rent, and the block's age apart from the flat's", async () => {
  const { store, landlordId } = setup();
  const context = await createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool })(landlordId);

  const system = landlordSystemMessage({ context, language: "en" }).content;

  assert.match(system, /"range" is the Mietspiegel spread for comparable flats, not a legal limit: never call its upper bound "allowed"/);
  assert.match(system, /legally allowed maximum on a re-let is the Mietpreisbremse cap \("allowedRent"/);
  assert.match(system, /"buildingAgePeriod"\) is when the flat's block was predominantly built .*not the flat's own construction year/);
  assert.match(system, /unless the landlord stated the building year/);
});

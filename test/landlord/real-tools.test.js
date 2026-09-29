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

function setup({ withListing = true } = {}) {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Erika Muster");
  if (withListing) store.saveListing(landlordId, listing);
  const { tools } = createLandlordTools({ getStore: () => store, getApplicantPool: async () => pool, fetchImpl: createFakeBerlinWfs().fetchImpl });
  const byName = new Map(tools.map((candidate) => [candidate.name, candidate]));
  const call = (name, args = {}) => byName.get(name).invoke(args, { configurable: { landlordId } });
  return { store, landlordId, tools, call };
}

const someApplicant = pool.applicants[0].id;

const SAMPLE_ARGS = {
  get_ranking: {},
  get_applicant_profile: { applicantId: someApplicant },
  update_selection_criteria: { changes: [{ requirement: "schufaCleanOnly", value: true }] },
  adjust_selection_criteria: { changes: [{ criterion: "employment", by: "factor", value: 2 }] },
  update_flat_details: { facts: [{ fact: "askingRent", value: 950 }] },
  remember_preference: { note: "I'd like someone who stays long-term." },
  update_shortlist: { applicantId: someApplicant, status: "to_invite", note: "Stable income" },
  get_rent_check: {},
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

test("adjust_selection_criteria: saves, and returns the old and new shares to one decimal, what was applied and the new top 3", async () => {
  const { store, landlordId, call } = setup();

  const result = await call("adjust_selection_criteria", { changes: [{ criterion: "schufa", by: "factor", value: 1.3 }] });

  // The plan's example: SCHUFA 20 → 26, the other five (80) scaled to 74.
  assert.deepEqual(result.previous.weights, DEFAULT_CRITERIA.weights);
  assert.deepEqual(result.criteria.weights, { affordability: 27.8, schufa: 26, documents: 13.9, credibility: 13.9, employment: 13.9, previousLandlord: 4.6 });
  assert.deepEqual(result.applied, [{ criterion: "schufa", from: 20, requested: 26, to: 26, capped: false }]);
  assert.deepEqual(result.top.map(({ rank }) => rank), [1, 2, 3]);
  assert.deepEqual(result.inactive, []);
  assert.equal(store.getCriteria(landlordId).weights.affordability, 27.75, "saved unrounded");
  // The limit the chat may mention ("no criterion above 50 %") comes with the result, so it is grounded.
  assert.equal(result.maxShare, 50);
});

test("adjust_selection_criteria reports a capped share, rounded", async () => {
  const { call } = setup();

  const result = await call("adjust_selection_criteria", { changes: [{ criterion: "affordability", by: "factor", value: 2 }] });

  // 30 × 2 = 60, capped at 50; the other five (70) scaled to 50: SCHUFA 14.29, documents 10.71,
  // previous landlord 3.57.
  assert.deepEqual(result.applied, [{ criterion: "affordability", from: 30, requested: 60, to: 50, capped: true }]);
  assert.deepEqual(result.criteria.weights, { affordability: 50, schufa: 14.3, documents: 10.7, credibility: 10.7, employment: 10.7, previousLandlord: 3.6 });
});

test("changing an inactive criterion's weight still saves it, and the result says it is inactive", async () => {
  const { store, landlordId, call } = setup({ withListing: false });

  const result = await call("adjust_selection_criteria", { changes: [{ criterion: "affordability", by: "factor", value: 1.3 }] });

  // 30 → 39; the other five (70) scaled to 61.
  assert.equal(result.criteria.weights.affordability, 39);
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

test("a whitespace-only note is an input error and nothing is stored", async () => {
  const { landlordId, store, call } = setup({ withListing: false });
  const getContext = createLandlordContext({ getStore: () => store, getApplicantPool: async () => pool });
  await assert.rejects(call("remember_preference", { note: "   " }), (error) => error.kind === "input");
  const context = await getContext(landlordId);
  assert.equal(context.listing, null);
  assert.deepEqual(context.preferences.notes, []);
});

// The real landlord Tools (src/landlord/orchestrator/landlord-tools.js) against their shared zod
// contracts, on the committed Applicant pool and an in-memory landlord store.
import test from "node:test";
import assert from "node:assert/strict";

import { APPLICANT_POOL_DIRECTORY, readApplicantPool } from "../../src/landlord/applicant-pool.js";
import { POOL_DATE } from "../../src/landlord/applicant-pool-generator.js";
import { buildListing } from "../../src/landlord/listing.js";
import { createLandlordTools, LANDLORD_TOOL_CONTRACTS, LANDLORD_TOOL_NAMES } from "../../src/landlord/orchestrator/index.js";
import { createLandlordStore } from "../../src/landlord/store.js";
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
  const { tools } = createLandlordTools({ getStore: () => store, getApplicantPool: async () => pool });
  const byName = new Map(tools.map((candidate) => [candidate.name, candidate]));
  const call = (name, args = {}) => byName.get(name).invoke(args, { configurable: { landlordId } });
  return { store, landlordId, tools, call };
}

const someApplicant = pool.applicants[0].id;

const SAMPLE_ARGS = {
  get_ranking: {},
  get_applicant_profile: { applicantId: someApplicant },
  update_selection_criteria: { weights: { employment: 30 }, requirements: { schufaCleanOnly: true } },
  remember_preference: { note: "I'd like someone who stays long-term." },
  update_shortlist: { applicantId: someApplicant, status: "to_invite", note: "Stable income" },
  get_rent_check: {},
};

test("there is a real Tool for every contract, and each result satisfies its output schema", async () => {
  for (const withListing of [true, false]) {
    const { tools, call } = setup({ withListing });
    assert.deepEqual(tools.map(({ name }) => name).sort(), [...LANDLORD_TOOL_NAMES].sort());
    for (const name of LANDLORD_TOOL_NAMES) {
      if (name === "get_ranking" && !withListing) continue;
      const result = await call(name, SAMPLE_ARGS[name]);
      assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS[name].output.parse(result), `${name} (listing: ${withListing})`);
    }
  }
});

test("without a Listing there is no ranking: get_ranking tells the model to ask for the Listing", async () => {
  const { call } = setup({ withListing: false });
  await assert.rejects(call("get_ranking"), (error) => error.kind === "input" && /not saved a Listing/.test(error.message));
  const rent = await call("get_rent_check");
  assert.equal(rent.rentCheck, null);
  assert.match(rent.note, /not saved a Listing/);
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

test("update_selection_criteria: saves, and returns the old and new criteria (weights to one decimal) and the new top 3", async () => {
  const { store, landlordId, call } = setup();

  const result = await call("update_selection_criteria", { weights: { employment: 50 } });

  // 30 + 20 + 15 + 15 + 50 + 5 = 135: employment 50/135 = 37.0 %, affordability 30/135 = 22.2 %.
  assert.equal(result.previous.weights.employment, 15);
  assert.equal(result.criteria.weights.employment, 37);
  assert.equal(result.criteria.weights.affordability, 22.2);
  assert.equal(result.top.length, 3);
  assert.deepEqual(result.top.map(({ rank }) => rank), [1, 2, 3]);
  assert.ok(Math.abs(store.getCriteria(landlordId).weights.employment - 5000 / 135) < 1e-9, "saved unrounded");
});

test("update_selection_criteria and update_shortlist refuse invalid input as input errors, saving nothing", async () => {
  const { store, landlordId, call } = setup();
  const zero = Object.fromEntries(Object.keys(store.getCriteria(landlordId).weights).map((key) => [key, 0]));

  await assert.rejects(call("update_selection_criteria", { weights: zero }), (error) => error.kind === "input" && /above zero/.test(error.message));
  await assert.rejects(call("update_shortlist", { applicantId: "A-999", status: "to_invite" }), (error) => error.kind === "input");
  assert.equal(store.getCriteria(landlordId).weights.employment, 15);
  assert.deepEqual(store.getShortlist(landlordId), []);
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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

import { createApp } from "../../src/app.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";

// Starts the app on a free port with an in-memory landlord store (or `store`) and the
// Berlin WFS faked (`wfs`: createFakeBerlinWfs options).
// `env` configures the rest (e.g. APPLICANT_POOL_DIR); by default the committed Applicant pool.
async function start({ store = createLandlordStore({ path: ":memory:" }), wfs = {}, env = {} } = {}) {
  const app = createApp({ env, landlordStore: store, fetchImpl: createFakeBerlinWfs(wfs).fetchImpl });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const send = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return {
    base,
    close: () => new Promise((resolve) => app.close(resolve)),
    get: (path) => send("GET", path),
    post: (path, body) => send("POST", path, body),
    put: (path, body) => send("PUT", path, body),
    del: (path) => send("DELETE", path),
  };
}

// Wühlischstraße 30 (fake WFS): Wohnlage gut, block built 1901-1910 → "bis 1918", 40–60 m²:
// 8,40 / 9,80 / 12,20 €/m² (field C4), i.e. 420 / 490 / 610 € for 50 m²; Mietspiegel + 10 %: 539 €.
const WUEHLISCH_LISTING = { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 50, rooms: 2, askingRent: 700 };

const signIn = async (server, name = "Erika Muster") =>
  (await server.post("/api/v1/landlord/sessions", { name })).body.data.landlordId;

test("saving a weight merges the other criteria, normalises to 100 and returns the new ranking", async (t) => {
  const server = await start();
  t.after(server.close);
  const id = await signIn(server);
  const base = `/api/v1/landlord/${id}`;
  await server.put(`${base}/listing`, WUEHLISCH_LISTING);
  const before = (await server.get(`${base}/dashboard`)).body.data;
  const { status, body } = await server.put(`${base}/criteria`, { weights: { affordability: 130 } });

  assert.equal(status, 200);
  assert.deepEqual(body.data.criteria.weights, { affordability: 65, schufa: 10, documents: 7.5, credibility: 7.5, employment: 7.5, previousLandlord: 2.5 });
  assert.deepEqual(body.data.criteria.requirements, before.criteria.requirements);
  assert.notDeepEqual(body.data.ranked, before.ranked);
  assert.ok(body.data.ranked.every((entry) => entry.breakdown.affordability.weight === 65));
  assert.deepEqual((await server.get(`${base}/dashboard`)).body.data, body.data);
});

test("invalid criteria return 422 without overwriting the saved criteria", async (t) => {
  const server = await start();
  t.after(server.close);
  const id = await signIn(server);
  const base = `/api/v1/landlord/${id}`;
  const before = (await server.get(`${base}/dashboard`)).body.data.criteria;
  const invalid = [
    null, [], { weights: null }, { weights: [] }, { requirements: null },
    { weights: { affordability: -1 } }, { weights: { schufa: "20" } },
    { weights: { nationality: 10 } }, { requirements: { religion: true } }, { unexpected: true },
    { weights: { affordability: 0, schufa: 0, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 } },
    { requirements: { noPets: "true" } }, { requirements: { occupancyCompliant: null } },
    { requirements: { maxRentToIncome: 0 } }, { requirements: { maxRentToIncome: 1.1 } },
    { requirements: { latestMoveIn: "2026-02-30" } }, { requirements: { latestMoveIn: "tomorrow" } },
  ];
  for (const input of invalid) {
    const { status, body } = await server.put(`${base}/criteria`, input);
    assert.equal(status, 422, JSON.stringify(input));
    assert.equal(body.error.code, "validation_error");
    assert.ok(body.error.details.length > 0);
    assert.deepEqual((await server.get(`${base}/dashboard`)).body.data.criteria, before);
  }
  assert.equal((await server.put("/api/v1/landlord/unknown/criteria", {})).status, 404);
});

test("saved requirements merge, refresh stats and recommendations, and can be cleared", async (t) => {
  const server = await start();
  t.after(server.close);
  const id = await signIn(server);
  const base = `/api/v1/landlord/${id}`;
  await server.put(`${base}/listing`, WUEHLISCH_LISTING);
  const before = (await server.get(`${base}/dashboard`)).body.data;
  await server.put(`${base}/criteria`, { requirements: { schufaCleanOnly: true } });
  const changed = (await server.put(`${base}/criteria`, { requirements: { maxRentToIncome: 0.25, latestMoveIn: "2026-12-31" } })).body.data;
  assert.equal(changed.criteria.requirements.schufaCleanOnly, true);
  assert.equal(changed.stats.maxRentToIncome, 0.25);
  assert.ok(changed.stats.canAfford < before.stats.canAfford);
  assert.ok(changed.excluded.length > before.excluded.length);
  assert.ok(changed.ranked.every(({ rentToIncome }) => rentToIncome <= 0.25));
  assert.deepEqual(changed.recommendations.map(({ applicantId }) => applicantId), changed.ranked.slice(0, 2).map(({ applicantId }) => applicantId));
  const reset = await server.put(`${base}/criteria`, before.criteria);
  assert.deepEqual(reset.body.data, before);
});

test("criteria survive a restart and returning sign-in without changing another landlord's defaults", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-criteria-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");
  const firstStore = createLandlordStore({ path });
  const first = await start({ store: firstStore });
  let id;
  let saved;
  try {
    id = await signIn(first);
    saved = (await first.put(`/api/v1/landlord/${id}/criteria`, {
      weights: { affordability: 130 }, requirements: { noSmoking: true, noPets: true },
    })).body.data.criteria;
  } finally {
    await first.close();
    firstStore.close();
  }
  const secondStore = createLandlordStore({ path });
  const second = await start({ store: secondStore });
  t.after(async () => { await second.close(); secondStore.close(); });
  assert.equal(await signIn(second, "ERIKA MUSTER"), id);
  assert.deepEqual((await second.get(`/api/v1/landlord/${id}/dashboard`)).body.data.criteria, saved);
  const otherId = await signIn(second, "Another landlord");
  const other = (await second.get(`/api/v1/landlord/${otherId}/dashboard`)).body.data.criteria;
  assert.equal(other.weights.affordability, 30);
  assert.equal(other.requirements.noSmoking, false);
});

test("signing in with a new name creates a landlord", async (t) => {
  const server = await start();
  t.after(server.close);

  const { status, body } = await server.post("/api/v1/landlord/sessions", { name: "  Erika Muster " });

  assert.equal(status, 200);
  assert.equal(body.data.name, "Erika Muster");
  assert.equal(typeof body.data.landlordId, "string");
  assert.ok(body.data.landlordId.length > 0);
});

test("signing in again with the same name, in any case and spacing, returns the same landlord", async (t) => {
  const server = await start();
  t.after(server.close);

  const first = await server.post("/api/v1/landlord/sessions", { name: "Erika Muster" });
  const again = await server.post("/api/v1/landlord/sessions", { name: "  erika   MUSTER" });
  const other = await server.post("/api/v1/landlord/sessions", { name: "Max Muster" });

  assert.deepEqual(again.body, first.body);
  assert.notEqual(other.body.data.landlordId, first.body.data.landlordId);
});

test("signing in without a usable name is a 422 in the usual error shape", async (t) => {
  const server = await start();
  t.after(server.close);

  for (const body of [{ name: "   " }, {}, { name: 42 }, [], { name: "x".repeat(101) }]) {
    const { status, body: error } = await server.post("/api/v1/landlord/sessions", body);
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(error.error.code, "validation_error");
    assert.equal(error.error.details[0].field, "name");
  }
});

test("a new landlord's dashboard has no Listing and no Rent check yet", async (t) => {
  const server = await start();
  t.after(server.close);
  const { landlordId } = (await server.post("/api/v1/landlord/sessions", { name: "Erika" })).body.data;

  const { status, body } = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(status, 200);
  assert.equal(body.data.listing, null);
  assert.equal(body.data.rentCheck, null);
});

test("an unknown landlord is a 404, for the dashboard and the Listing", async (t) => {
  const server = await start();
  t.after(server.close);

  const dashboard = await server.get("/api/v1/landlord/no-such-landlord/dashboard");
  const listing = await server.put("/api/v1/landlord/no-such-landlord/listing", WUEHLISCH_LISTING);

  for (const { status, body } of [dashboard, listing]) {
    assert.equal(status, 404);
    assert.equal(body.error.code, "landlord_not_found");
  }
});

test("saving a Listing verifies the address, looks up the official facts and returns its Rent check", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  const { status, body } = await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);

  assert.equal(status, 200);
  const listing = body.data;
  assert.equal(listing.addressVerified, true);
  assert.equal(listing.canonicalAddress.street, "Wühlischstraße");
  assert.equal(listing.canonicalAddress.postalCode, "10245");
  assert.equal(listing.livingAreaSqm, 50);
  assert.equal(listing.rooms, 2);
  assert.equal(listing.askingRent, 700);
  assert.equal(listing.buildingYear, null);
  assert.equal(listing.residentialLocation, "gut");
  assert.equal(listing.buildingAgePeriod, "1901-1910");
  assert.equal(listing.note, null);
  assert.deepEqual(listing.rentCheck.range, { lower: 420, median: 490, upper: 610 });
  assert.equal(listing.rentCheck.askingRent, 700);
  assert.equal(listing.rentCheck.position, "high");
  assert.equal(listing.rentCheck.aboveCap, true);
  assert.equal(listing.rentCheck.allowedRent, 539);
  assert.equal(listing.rentCheck.differenceFromAllowed, 161);
});

test("an asking rent within Mietspiegel + 10 % is typical and not above the cap; the dashboard shows the saved Listing", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  const saved = await server.put(`/api/v1/landlord/${landlordId}/listing`, { ...WUEHLISCH_LISTING, askingRent: 530 });
  const { status, body } = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(saved.body.data.rentCheck.position, "typical");
  assert.equal(saved.body.data.rentCheck.aboveCap, false);
  assert.equal(saved.body.data.rentCheck.allowedRent, 539);
  assert.equal(status, 200);
  assert.deepEqual(body.data.listing, saved.body.data);
  assert.deepEqual(body.data.rentCheck, saved.body.data.rentCheck);
});

test("an asking rent below the range is low, and a stated building year replaces the block's period", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  // Built 1955 → class 1950–1964, Wohnlage gut, 40–60 m²: 7,50 / 8,60 / 10,20 €/m² (field E4), 375 / 430 / 510 €.
  const { body } = await server.put(`/api/v1/landlord/${landlordId}/listing`, {
    ...WUEHLISCH_LISTING,
    askingRent: 350,
    buildingYear: 1955,
  });

  assert.equal(body.data.buildingYear, 1955);
  assert.equal(body.data.buildingAgePeriod, "1901-1910", "the official period is still shown");
  assert.deepEqual(body.data.rentCheck.range, { lower: 375, median: 430, upper: 510 });
  assert.equal(body.data.rentCheck.position, "low");
  assert.equal(body.data.rentCheck.allowedRent, 473);
});

test("editing the Listing replaces it", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, { ...WUEHLISCH_LISTING, askingRent: 520 });
  const { body } = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(body.data.listing.askingRent, 520);
  assert.equal(body.data.rentCheck.aboveCap, false);
});

test("a Listing the server cannot use is a 422 naming each field, and nothing is saved", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  const cases = [
    [{}, ["address", "livingAreaSqm", "rooms", "askingRent"]],
    [{ ...WUEHLISCH_LISTING, livingAreaSqm: "50" }, ["livingAreaSqm"]],
    [{ ...WUEHLISCH_LISTING, askingRent: -1, rooms: 0 }, ["rooms", "askingRent"]],
    [{ ...WUEHLISCH_LISTING, buildingYear: 1500 }, ["buildingYear"]],
    [{ ...WUEHLISCH_LISTING, address: "somewhere in Berlin" }, ["address"]],
    [{ ...WUEHLISCH_LISTING, address: "Hauptstraße 1, 80331 München" }, ["address"]],
  ];

  for (const [input, fields] of cases) {
    const { status, body } = await server.put(`/api/v1/landlord/${landlordId}/listing`, input);
    assert.equal(status, 422, JSON.stringify(input));
    assert.equal(body.error.code, "validation_error");
    assert.deepEqual(body.error.details.map((d) => d.field), fields, JSON.stringify(input));
  }
  assert.equal((await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data.listing, null);
});

test("an address the official register does not know is saved and reported, without a Rent check", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  const { status, body } = await server.put(`/api/v1/landlord/${landlordId}/listing`, {
    ...WUEHLISCH_LISTING,
    address: "Wühlischstraße 999, 10245 Berlin",
  });
  const dashboard = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(status, 200);
  assert.equal(body.data.addressVerified, false);
  assert.equal(body.data.canonicalAddress, null);
  assert.equal(body.data.rentCheck, null);
  assert.equal(body.data.note.code, "address_not_verified");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.data.listing.note.code, "address_not_verified");
  assert.equal(dashboard.body.data.rentCheck, null);
});

for (const service of ["address", "residentialLocation", "buildingAge"]) {
  test(`when the Berlin ${service} service fails, the Listing is saved without a Rent check and says the service is unavailable`, async (t) => {
    const server = await start({ wfs: { status: { [service]: 503 } } });
    t.after(server.close);
    const landlordId = await signIn(server);

    const { status, body } = await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
    const dashboard = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

    assert.equal(status, 200);
    assert.equal(body.data.rentCheck, null);
    assert.equal(body.data.note.code, "berlin_data_service_unavailable");
    assert.equal(body.data.askingRent, 700);
    assert.equal(dashboard.body.data.listing.note.code, "berlin_data_service_unavailable");
  });
}

test("the landlord and the Listing survive re-creating the app on the same database file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-landlord-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "landlord.sqlite");

  const firstStore = createLandlordStore({ path });
  const first = await start({ store: firstStore });
  const landlordId = await signIn(first, "Erika Muster");
  const saved = await first.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
  await first.close();
  firstStore.close();

  const secondStore = createLandlordStore({ path });
  const second = await start({ store: secondStore });
  t.after(async () => {
    await second.close();
    secondStore.close();
  });
  const again = await second.post("/api/v1/landlord/sessions", { name: "ERIKA MUSTER" });
  const dashboard = await second.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(again.body.data.landlordId, landlordId);
  assert.deepEqual(dashboard.body.data.listing, saved.body.data);
});

test("the landlord page is served at /landlord", async (t) => {
  const server = await start();
  t.after(server.close);

  const response = await fetch(`${server.base}/landlord`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.ok(html.includes('src="/landlord.js"'));
});

test("with a stated building year, a failing building-age service does not stop the Rent check", async (t) => {
  const server = await start({ wfs: { status: { buildingAge: 503 } } });
  t.after(server.close);
  const landlordId = await signIn(server);

  const { body } = await server.put(`/api/v1/landlord/${landlordId}/listing`, { ...WUEHLISCH_LISTING, buildingYear: 1905 });

  assert.equal(body.data.buildingAgePeriod, null);
  assert.deepEqual(body.data.rentCheck.range, { lower: 420, median: 490, upper: 610 });
  assert.equal(body.data.note, null);
});

// --- The dashboard's ranking (over the committed Applicant pool, data/applicants) -------------

test("without a Listing the dashboard has an empty ranking and a hint to save one", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  const { status, body } = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(status, 200);
  assert.deepEqual(body.data.ranked, []);
  assert.deepEqual(body.data.excluded, []);
  assert.equal(body.data.hint.code, "listing_required");
  assert.equal(typeof body.data.hint.message, "string");
  assert.deepEqual(body.data.criteria.weights, { affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 });
});

test("with a Listing the dashboard ranks the committed pool, households too large for the flat excluded", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);

  const { status, body } = await server.get(`/api/v1/landlord/${landlordId}/dashboard`);

  assert.equal(status, 200);
  const { ranked, excluded, hint, criteria, poolErrors } = body.data;
  assert.equal(hint, null);
  assert.deepEqual(poolErrors, []);
  assert.equal(criteria.requirements.occupancyCompliant, true);
  // 50 m²: the pool's households of six and seven need 51–63 m² under § 7 WoAufG Bln.
  assert.deepEqual(excluded.map(({ applicantId }) => applicantId), ["A-017", "A-020", "A-021", "A-035"]);
  assert.ok(excluded.every(({ excludedBy }) => excludedBy === "occupancyCompliant"));
  assert.equal(ranked.length, 91);
  assert.deepEqual(ranked.map(({ rank }) => rank), Array.from({ length: 91 }, (_, index) => index + 1));
  for (let index = 1; index < ranked.length; index += 1) assert.ok(ranked[index - 1].matchScore >= ranked[index].matchScore);
});

test("the dashboard joins in the applicant's name for display, with the document flags and no contact details", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);

  const { ranked, excluded } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  for (const entry of [...ranked, ...excluded]) {
    assert.equal(typeof entry.name, "string", entry.applicantId);
    assert.ok(entry.name.trim());
    assert.equal(entry.email, undefined);
    assert.equal(entry.phone, undefined);
    assert.deepEqual(Object.keys(entry.documents), ["schufa", "incomeProof", "previousLandlord", "arrears", "complete"]);
  }
  // The committed pool has applicants whose previous landlord confirms rent arrears.
  assert.ok([...ranked, ...excluded].some(({ documents }) => documents.arrears && documents.previousLandlord === "present"));
  const entry = ranked[0];
  assert.deepEqual(Object.keys(entry.breakdown), ["affordability", "schufa", "documents", "credibility", "employment", "previousLandlord"]);
  assert.equal(typeof entry.rentToIncome, "number");
});

test("applicant detail returns the anonymised profile, document issues, the same score as the dashboard, and contact", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
  const dashboard = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;
  const ranked = dashboard.ranked.find(({ applicantId }) => applicantId === "A-001");

  const { status, body } = await server.get(`/api/v1/landlord/${landlordId}/applicants/A-001`);

  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.data), ["profile", "score", "rentToIncome", "contact", "clarification"]);
  assert.equal(body.data.profile.id, "A-001");
  assert.equal(body.data.profile.householdSize, 2);
  assert.equal(body.data.profile.netHouseholdIncome, 6070);
  assert.equal(body.data.profile.employmentType, "permanent");
  assert.equal(body.data.profile.schufaStatus, "negative");
  assert.equal(body.data.profile.moveInDate, "2026-12-15");
  assert.equal(body.data.profile.pets, false);
  assert.equal(body.data.profile.smoking, true);
  assert.deepEqual(Object.keys(body.data.profile.documentCheck), ["schufa", "incomeProof", "previousLandlord", "complete", "issues"]);
  assert.equal(body.data.profile.credibilityScore, 100);
  assert.deepEqual(body.data.score, {
    applicantId: ranked.applicantId, rank: ranked.rank, matchScore: ranked.matchScore,
    breakdown: ranked.breakdown, rentToIncome: ranked.rentToIncome,
  });
  assert.equal(body.data.rentToIncome, ranked.rentToIncome);
  assert.deepEqual(body.data.contact, { name: "Julien Neumann", email: "julien.neumann1@example.org", phone: "+49 178 4053388" });
});

test("applicant detail reports a name clarification separately from a requirement exclusion", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);

  const excluded = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data.excluded[0];
  const detail = (await server.get(`/api/v1/landlord/${landlordId}/applicants/${excluded.applicantId}`)).body.data;
  assert.deepEqual(detail.score, { applicantId: excluded.applicantId, excludedBy: excluded.excludedBy, reasons: excluded.reasons });
  assert.equal(typeof detail.rentToIncome, "number");

  const directory = fileURLToPath(new URL("../fixtures/applicants/", import.meta.url));
  const fixtures = await start({ env: { APPLICANT_POOL_DIR: directory, APPLICANT_POOL_TODAY: "2026-09-29" } });
  t.after(fixtures.close);
  const fixtureLandlordId = await signIn(fixtures);
  const inconsistent = (await fixtures.get(`/api/v1/landlord/${fixtureLandlordId}/applicants/A-other-name`)).body.data;
  assert.equal(inconsistent.profile.documentCheck.incomeProof.status, "present");
  assert.deepEqual(inconsistent.clarification.documents, ["incomeProof"]);
  assert.ok(!inconsistent.profile.documentCheck.issues.some(({ code }) => code === "name_mismatch"));
  assert.ok(!JSON.stringify(inconsistent).includes("Jonas Schmidt"));
  assert.equal(inconsistent.profile.credibilityScore, 100);
  assert.equal(inconsistent.score, null); // no Listing yet
  assert.equal(inconsistent.rentToIncome, null);
});

test("applicant detail never exposes protected source fields or extra contact fields", async (t) => {
  const directory = fileURLToPath(new URL("../fixtures/applicants/", import.meta.url));
  const server = await start({ env: { APPLICANT_POOL_DIR: directory, APPLICANT_POOL_TODAY: "2026-09-29" } });
  t.after(server.close);
  const landlordId = await signIn(server);
  const { status, body } = await server.get(`/api/v1/landlord/${landlordId}/applicants/A-protected`);

  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.data.contact), ["name", "email", "phone"]);
  assert.deepEqual(Object.keys(body.data.profile), [
    "id", "householdSize", "household", "netHouseholdIncome", "employmentType", "schufaStatus", "moveInDate", "pets", "smoking", "documentCheck", "credibilityScore",
  ]);
  for (const value of ["Italian", "Catholic", "1988-04-12", "female", "a-protected.jpg", "expecting a second child", "Siemens AG", "Kastanienallee", "@lena.berlin"]) {
    assert.ok(!JSON.stringify(body).includes(value), value);
  }
});

test("applicant detail returns 404 for an unknown applicant or landlord", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  const missing = await server.get(`/api/v1/landlord/${landlordId}/applicants/not-here`);
  const unknownLandlord = await server.get("/api/v1/landlord/not-here/applicants/A-001");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "applicant_not_found");
  assert.equal(unknownLandlord.status, 404);
  assert.equal(unknownLandlord.body.error.code, "landlord_not_found");
});

test("applicant detail responses cannot be cached", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  const response = await server.get(`/api/v1/landlord/${landlordId}/applicants/A-001`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the dashboard has the pool stats and the Recommendations, with names joined in", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);

  const { stats, recommendations, ranked } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  // The committed pool: 95 applicants, 4 households too large for 50 m².
  assert.equal(stats.total, 95);
  assert.equal(stats.excluded, 4);
  assert.equal(stats.maxRentToIncome, 1 / 3);
  // The Rent check's median for this flat is 490 €, below the asking 700 €: more can afford it.
  assert.equal(stats.medianRent, 490);
  assert.ok(stats.canAffordAtMedian > stats.canAfford, JSON.stringify(stats));
  for (const count of ["completeDocuments", "canAfford", "canAffordAtMedian", "cleanSchufa"]) {
    assert.ok(Number.isInteger(stats[count]) && stats[count] >= 0 && stats[count] <= stats.total, count);
  }

  assert.deepEqual(recommendations.map(({ applicantId }) => applicantId), ranked.slice(0, 2).map(({ applicantId }) => applicantId));
  for (const recommendation of recommendations) {
    assert.equal(recommendation.name, ranked.find(({ applicantId }) => applicantId === recommendation.applicantId).name);
    assert.equal(recommendation.email, undefined);
    assert.match(recommendation.reason.en, /^You may like this applicant for their /);
    assert.match(recommendation.reason.de, /^Dieser Bewerber könnte Ihnen gefallen: /);
  }
});

test("without a Listing there are no stats and no Recommendations; without a Rent check the median count is unavailable", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  const before = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;
  await server.put(`/api/v1/landlord/${landlordId}/listing`, { ...WUEHLISCH_LISTING, address: "Wühlischstraße 999, 10245 Berlin" });
  const after = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  assert.equal(before.stats, null);
  assert.deepEqual(before.recommendations, []);
  assert.equal(after.rentCheck, null);
  assert.equal(after.stats.total, 95);
  assert.equal(after.stats.canAffordAtMedian, null);
  assert.equal(after.stats.medianRent, null);
  assert.equal(after.recommendations.length, 2);
});

test("the Applicant pool directory and its day are configurable", async (t) => {
  const directory = fileURLToPath(new URL("../fixtures/applicants/", import.meta.url));
  const server = await start({ env: { APPLICANT_POOL_DIR: directory, APPLICANT_POOL_TODAY: "2026-09-29" } });
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, { ...WUEHLISCH_LISTING, livingAreaSqm: 90 });

  const { ranked, excluded, poolErrors } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;
  const all = [...ranked, ...excluded];

  assert.ok(all.some(({ applicantId, name }) => applicantId === "A-complete" && name === "Lena Schmidt"));
  assert.ok(!all.some(({ applicantId }) => applicantId.startsWith("A-0")), "not the committed pool");
  assert.ok(poolErrors.some(({ file }) => file === "malformed.md"));
});

test("a simulated name clarification persists with a 24-hour deadline and does not change the ranking", async (t) => {
  const server = await start({ env: { APPLICANT_POOL_DIR: fileURLToPath(new URL("../fixtures/applicants/", import.meta.url)) } });
  t.after(server.close);
  const id = await signIn(server);
  const base = `/api/v1/landlord/${id}`;
  await server.put(`${base}/listing`, WUEHLISCH_LISTING);
  const before = (await server.get(`${base}/dashboard`)).body.data;
  const path = `${base}/applicants/A-other-name`;
  const result = await server.post(`${path}/clarification`, {});
  assert.equal(result.status, 200);
  const { clarification } = result.body.data;
  assert.deepEqual(clarification.documents, ["incomeProof"]);
  assert.equal(clarification.request.status, "pending");
  assert.equal(clarification.request.simulated, true);
  assert.equal(Date.parse(clarification.request.deadline) - Date.parse(clarification.request.requestedAt), 24 * 60 * 60 * 1000);
  assert.deepEqual((await server.get(path)).body.data.clarification, clarification);
  assert.deepEqual((await server.post(`${path}/clarification`, {})).body.data.clarification, clarification, "retrying must not extend the deadline");
  assert.deepEqual((await server.get(`${base}/dashboard`)).body.data, before);
});

test("a name discrepancy alone cannot fail complete-document or clean-SCHUFA requirements", async (t) => {
  const server = await start({ env: { APPLICANT_POOL_DIR: fileURLToPath(new URL("../fixtures/applicants/", import.meta.url)) } });
  t.after(server.close);
  const id = await signIn(server);
  const base = `/api/v1/landlord/${id}`;
  await server.put(`${base}/listing`, WUEHLISCH_LISTING);
  await server.put(`${base}/criteria`, { requirements: { completeDocumentsOnly: true, schufaCleanOnly: true } });
  const complete = (await server.get(`${base}/applicants/A-complete`)).body.data;
  for (const applicantId of ["A-other-name", "A-other-name-schufa"]) {
    const detail = (await server.get(`${base}/applicants/${applicantId}`)).body.data;
    assert.equal(detail.profile.credibilityScore, 100);
    assert.equal(detail.score.matchScore, complete.score.matchScore);
    assert.equal(detail.profile.schufaStatus, "clean");
    assert.equal(detail.profile.documentCheck.complete, true);
    assert.equal(detail.clarification.request, null);
    assert.doesNotMatch(JSON.stringify(detail.profile), /Jonas Schmidt|Lena Schmidt|another person's/);
  }
});


test("presentation variants avoid clarification, but different or missing name parts still need it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-names-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await readFile(new URL("../fixtures/applicants/complete.md", import.meta.url), "utf8");
  const cases = [
    ["Dr. Juan Orozco", "Juan Orozco", false],
    ["Ana-María de la Cruz", "Ana Maria de la Cruz", false],
    ["José O’Neill", "Jose\u0301 O'Neill", false],
    ["Prof. Dr. Zoë Müller", "  zoe   muller  ", false],
    ["Maria Ana Cruz", "Mariana Cruz", true],
    ["Juan Carlos Orozco", "Juan Orozco", true],
    ["Juan Orozco", "Diego Orozco", true],
    ["कीरण", "किरण", true],
  ];
  for (const [index, [declared, document]] of cases.entries()) {
    await writeFile(join(directory, `${index}.md`), fixture.replace("A-complete", `A-${index}`)
      .replace("name: Lena Schmidt", `name: ${declared}`).replaceAll("Name: Lena Schmidt", `Name: ${document}`));
  }
  const server = await start({ env: { APPLICANT_POOL_DIR: directory } });
  t.after(server.close);
  const id = await signIn(server);
  for (const [index, [, , needsClarification]] of cases.entries()) {
    const detail = (await server.get(`/api/v1/landlord/${id}/applicants/A-${index}`)).body.data;
    assert.equal(Boolean(detail.clarification), needsClarification, cases[index].join(" / "));
    assert.equal(detail.profile.credibilityScore, 100);
  }
});


test("clarifications survive a restart, are landlord-specific, and becoming overdue never changes selection", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-clarification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");
  let today = "2026-09-29T12:00:00.000Z";
  const now = () => new Date(today);
  const firstStore = createLandlordStore({ path, now });
  const first = await start({ store: firstStore });
  let id, saved, ranking;
  try {
    id = await signIn(first);
    await first.put(`/api/v1/landlord/${id}/listing`, WUEHLISCH_LISTING);
    saved = (await first.post(`/api/v1/landlord/${id}/applicants/A-002/clarification`, {})).body.data.clarification;
    assert.equal(saved.request.deadline, "2026-09-30T12:00:00.000Z");
    ranking = (await first.get(`/api/v1/landlord/${id}/dashboard`)).body.data;
  } finally {
    await first.close();
    firstStore.close();
  }
  const secondStore = createLandlordStore({ path, now });
  const second = await start({ store: secondStore });
  t.after(async () => { await second.close(); secondStore.close(); });
  const applicantPath = `/api/v1/landlord/${id}/applicants/A-002`;
  assert.deepEqual((await second.get(applicantPath)).body.data.clarification, saved);
  const otherId = await signIn(second, "Another landlord");
  assert.equal((await second.get(`/api/v1/landlord/${otherId}/applicants/A-002`)).body.data.clarification.request, null);
  today = "2026-09-30T12:00:00.000Z";
  const overdue = (await second.get(applicantPath)).body.data.clarification;
  assert.equal(overdue.request.status, "overdue");
  assert.equal(overdue.request.deadline, saved.request.deadline);
  assert.deepEqual((await second.post(`${applicantPath}/clarification`, {})).body.data.clarification, overdue);
  assert.deepEqual((await second.get(`/api/v1/landlord/${id}/dashboard`)).body.data, ranking);
});

test("clarification refuses unknown applicants, missing sign-in, ineligible applicants, and custom payloads", async (t) => {
  const server = await start();
  t.after(server.close);
  const id = await signIn(server);
  const base = `/api/v1/landlord/${id}/applicants`;
  assert.equal((await server.post(`${base}/absent/clarification`, {})).body.error.code, "applicant_not_found");
  assert.equal((await server.post("/api/v1/landlord/absent/applicants/A-002/clarification", {})).body.error.code, "landlord_not_found");
  assert.equal((await server.post(`${base}/A-001/clarification`, {})).status, 409);
  for (const body of [null, [], { deadline: "2027-01-01" }, { send: true }]) {
    assert.equal((await server.post(`${base}/A-002/clarification`, body)).status, 422);
  }
  assert.equal((await server.get(`${base}/A-002`)).body.data.clarification.request, null);
});

test("name clarification does not hide expired reports, income discrepancies, or rent arrears", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await readFile(new URL("../fixtures/applicants/complete.md", import.meta.url), "utf8");
  await writeFile(join(directory, "application.md"), fixture
    .replaceAll("Name: Lena Schmidt", "Name: Another Applicant")
    .replace("2026-08-15", "2026-01-01")
    .replaceAll("3.790,00", "1.000,00").replaceAll("3.810,00", "1.000,00")
    .replace("Mietrückstände: nein", "Mietrückstände: ja"));
  const server = await start({ env: { APPLICANT_POOL_DIR: directory, APPLICANT_POOL_TODAY: "2026-09-29" } });
  t.after(server.close);
  const id = await signIn(server);
  const detail = (await server.get(`/api/v1/landlord/${id}/applicants/A-complete`)).body.data;
  assert.deepEqual(detail.clarification.documents, ["schufa", "incomeProof", "previousLandlord"]);
  assert.deepEqual(detail.profile.documentCheck.issues.map(({ code }) => code), ["schufa_expired", "income_mismatch", "rent_arrears"]);
  assert.equal(detail.profile.credibilityScore, 40);
  assert.equal(detail.profile.documentCheck.complete, false);
  assert.equal(detail.profile.documentCheck.previousLandlord.arrears, true);
});

test("saved seven-day demo requests adopt the 24-hour deadline from their original creation time", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-legacy-clarification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");
  // Fixture representing the previous version's database. All assertions use the HTTP API.
  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE landlords (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created TEXT NOT NULL);
    INSERT INTO landlords VALUES ('legacy', 'Legacy', 'legacy', '2026-09-29T12:00:00.000Z');
    CREATE TABLE clarification_requests (
      landlord_id TEXT NOT NULL REFERENCES landlords(id), applicant_id TEXT NOT NULL,
      requested_at TEXT NOT NULL, deadline TEXT NOT NULL, PRIMARY KEY (landlord_id, applicant_id)
    );
    INSERT INTO clarification_requests VALUES ('legacy', 'A-002', '2026-09-29T12:00:00.123Z', '2026-10-06T12:00:00.123Z');
  `);
  legacy.close();
  const store = createLandlordStore({ path, now: () => new Date("2026-10-01T12:00:00Z") });
  const server = await start({ store });
  t.after(async () => { await server.close(); store.close(); });
  const applicantPath = "/api/v1/landlord/legacy/applicants/A-002";
  const detail = (await server.get(applicantPath)).body.data;
  assert.equal(detail.clarification.request.requestedAt, "2026-09-29T12:00:00.123Z");
  assert.equal(detail.clarification.request.deadline, "2026-09-30T12:00:00.123Z");
  assert.equal(detail.clarification.request.status, "overdue");
  assert.deepEqual((await server.post(`${applicantPath}/clarification`, {})).body.data.clarification, detail.clarification);
});
// --- The Shortlist ------------------------------------------------------------------------------

const shortlistPath = (landlordId, applicantId) => `/api/v1/landlord/${landlordId}/shortlist/${applicantId}`;

test("putting an applicant on the Shortlist returns the entry; the dashboard lists it with name, score and status", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
  const { ranked } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;
  const [first, second] = ranked;

  const added = await server.put(shortlistPath(landlordId, second.applicantId), { status: "to_invite", note: "Stable income" });
  await server.put(shortlistPath(landlordId, first.applicantId), { status: "invited" });
  const { shortlist } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  assert.equal(added.status, 200);
  assert.deepEqual(added.body.data, { applicantId: second.applicantId, status: "to_invite", note: "Stable income" });
  assert.deepEqual(
    shortlist.map(({ applicantId, name, status, note, rank, matchScore, excluded }) => ({ applicantId, name, status, note, rank, matchScore, excluded })),
    [
      { applicantId: second.applicantId, name: second.name, status: "to_invite", note: "Stable income", rank: 2, matchScore: second.matchScore, excluded: false },
      { applicantId: first.applicantId, name: first.name, status: "invited", note: null, rank: 1, matchScore: first.matchScore, excluded: false },
    ],
  );
  for (const entry of shortlist) assert.equal(entry.email, undefined);
});

test("changing a Shortlist entry's status keeps its note; DELETE removes it", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  await server.put(shortlistPath(landlordId, "A-001"), { status: "to_invite", note: "Call Monday" });
  const changed = await server.put(shortlistPath(landlordId, "A-001"), { status: "declined" });
  const removed = await server.del(shortlistPath(landlordId, "A-001"));
  const { shortlist } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  assert.deepEqual(changed.body.data, { applicantId: "A-001", status: "declined", note: "Call Monday" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.data, { applicantId: "A-001", status: "removed", note: null });
  assert.deepEqual(shortlist, []);
});

test("without a Listing, Shortlist entries have no rank or score; an excluded applicant is marked excluded", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  // A-017 is a household too large for 50 m² (see the ranking test above).
  await server.put(shortlistPath(landlordId, "A-017"), { status: "to_invite" });

  const before = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data.shortlist;
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
  const after = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data.shortlist;

  assert.equal(typeof before[0].name, "string");
  assert.deepEqual([before[0].rank, before[0].matchScore, before[0].excluded], [null, null, false]);
  assert.deepEqual([after[0].rank, after[0].matchScore, after[0].excluded], [null, null, true]);
});

test("an invalid status or note is a 422, an applicant outside the pool a 404, and nothing is saved", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);

  for (const body of [{ status: "maybe" }, {}, { status: "remove" }, { status: "invited", note: "x".repeat(501) }, []]) {
    const { status, body: error } = await server.put(shortlistPath(landlordId, "A-001"), body);
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(error.error.code, "validation_error");
  }
  const unknown = await server.put(shortlistPath(landlordId, "A-999"), { status: "to_invite" });
  const unknownDelete = await server.del(shortlistPath(landlordId, "A-999"));
  const { shortlist } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "applicant_not_found");
  assert.equal(unknownDelete.status, 404);
  assert.deepEqual(shortlist, []);
});

test("the Shortlist of an unknown landlord is a 404", async (t) => {
  const server = await start();
  t.after(server.close);

  const { status, body } = await server.put(shortlistPath("nobody", "A-001"), { status: "to_invite" });

  assert.equal(status, 404);
  assert.equal(body.error.code, "landlord_not_found");
});

test("the Shortlist survives re-creating the app on the same database file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-landlord-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");

  const firstStore = createLandlordStore({ path });
  const first = await start({ store: firstStore });
  const landlordId = await signIn(first);
  await first.put(shortlistPath(landlordId, "A-003"), { status: "invited", note: "Viewing Tuesday" });
  await first.close();
  firstStore.close();

  const secondStore = createLandlordStore({ path });
  const second = await start({ store: secondStore });
  t.after(async () => {
    await second.close();
    secondStore.close();
  });
  const { shortlist } = (await second.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  assert.deepEqual(
    shortlist.map(({ applicantId, status, note }) => ({ applicantId, status, note })),
    [{ applicantId: "A-003", status: "invited", note: "Viewing Tuesday" }],
  );
});

// Landlord preferences: the notes are remembered by the chat (remember_preference); here they
// are put in the store directly, and listed and deleted through the API.
const notesOf = async (server, landlordId) => (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data.notes;

test("the dashboard lists the landlord's remembered preferences, oldest first, with or without a Listing", async (t) => {
  const store = createLandlordStore({ path: ":memory:" });
  const server = await start({ store });
  t.after(server.close);
  const landlordId = await signIn(server);
  const other = await signIn(server, "Max Mustermann");
  const first = store.addNote(landlordId, "Wants someone who stays long-term.");
  const second = store.addNote(landlordId, "Prefers a quiet tenant.");

  assert.deepEqual(await notesOf(server, landlordId), [first, second]);
  assert.deepEqual(
    Object.keys(first).sort(),
    ["created", "note", "noteId"],
  );
  assert.deepEqual(await notesOf(server, other), []);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);
  assert.deepEqual(await notesOf(server, landlordId), [first, second]);
});

test("DELETE a note removes it; an unknown note, or another landlord's, is a 404 and nothing changes", async (t) => {
  const store = createLandlordStore({ path: ":memory:" });
  const server = await start({ store });
  t.after(server.close);
  const landlordId = await signIn(server);
  const other = await signIn(server, "Max Mustermann");
  const kept = store.addNote(landlordId, "Wants someone who stays long-term.");
  const gone = store.addNote(landlordId, "Prefers a quiet tenant.");
  const othersNote = store.addNote(other, "No pets.");

  const deleted = await server.del(`/api/v1/landlord/${landlordId}/notes/${gone.noteId}`);
  const again = await server.del(`/api/v1/landlord/${landlordId}/notes/${gone.noteId}`);
  const foreign = await server.del(`/api/v1/landlord/${landlordId}/notes/${othersNote.noteId}`);
  const bare = await server.del(`/api/v1/landlord/${landlordId}/notes`);
  const noLandlord = await server.del(`/api/v1/landlord/nobody/notes/${kept.noteId}`);

  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.data, { noteId: gone.noteId, deleted: true });
  assert.equal(again.status, 404);
  assert.equal(again.body.error.code, "note_not_found");
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, "note_not_found");
  assert.equal(bare.status, 404);
  assert.equal(noLandlord.body.error.code, "landlord_not_found");
  assert.deepEqual(await notesOf(server, landlordId), [kept]);
  assert.deepEqual(await notesOf(server, other), [othersNote]);
});

test("remembered preferences and their deletion survive re-creating the app on the same database file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-landlord-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");
  const restart = async () => {
    const store = createLandlordStore({ path });
    const server = await start({ store });
    return { store, server, stop: async () => { await server.close(); store.close(); } };
  };

  const first = await restart();
  const landlordId = await signIn(first.server);
  const kept = first.store.addNote(landlordId, "Wants someone who stays long-term.");
  const gone = first.store.addNote(landlordId, "Prefers a quiet tenant.");
  await first.stop();

  const second = await restart();
  assert.deepEqual(await notesOf(second.server, landlordId), [kept, gone]);
  assert.equal((await second.server.del(`/api/v1/landlord/${landlordId}/notes/${gone.noteId}`)).status, 200);
  await second.stop();

  const third = await restart();
  t.after(third.stop);
  assert.deepEqual(await notesOf(third.server, landlordId), [kept]);
});

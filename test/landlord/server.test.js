import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
    return { status: response.status, body: await response.json() };
  };
  return {
    base,
    close: () => new Promise((resolve) => app.close(resolve)),
    get: (path) => send("GET", path),
    post: (path, body) => send("POST", path, body),
    put: (path, body) => send("PUT", path, body),
  };
}

// Wühlischstraße 30 (fake WFS): Wohnlage gut, block built 1901-1910 → "bis 1918", 40–60 m²:
// 8,40 / 9,80 / 12,20 €/m² (field C4), i.e. 420 / 490 / 610 € for 50 m²; Mietspiegel + 10 %: 539 €.
const WUEHLISCH_LISTING = { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 50, rooms: 2, askingRent: 700 };

const signIn = async (server, name = "Erika Muster") =>
  (await server.post("/api/v1/landlord/sessions", { name })).body.data.landlordId;

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
  assert.equal(ranked.length, 36);
  assert.deepEqual(ranked.map(({ rank }) => rank), Array.from({ length: 36 }, (_, index) => index + 1));
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

test("the dashboard has the pool stats and the Recommendations, with names joined in", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await signIn(server);
  await server.put(`/api/v1/landlord/${landlordId}/listing`, WUEHLISCH_LISTING);

  const { stats, recommendations, ranked } = (await server.get(`/api/v1/landlord/${landlordId}/dashboard`)).body.data;

  // The committed pool: 40 applicants, 4 households too large for 50 m².
  assert.equal(stats.total, 40);
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
  assert.equal(after.stats.total, 40);
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

// The /landlord page's client code (public/landlord/*.js) against the real server (src/app.js):
// the same calls the page makes, with the Berlin WFS faked and an in-memory landlord store.
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { fetchApplicantProfile, fetchDashboard, saveCriteria, saveListing, signIn } from "../../public/landlord/api.js";
import { criteriaFormValues, criteriaRequest } from "../../public/landlord/criteria.js";
import { listingRequest } from "../../public/landlord/listing.js";
import { rankingRows } from "../../public/landlord/ranking.js";
import { poolSummary, recommendationCards, statTiles } from "../../public/landlord/pool-overview.js";

async function start() {
  const app = createApp({
    env: {},
    landlordStore: createLandlordStore({ path: ":memory:" }),
    fetchImpl: createFakeBerlinWfs().fetchImpl,
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return {
    // The page calls relative URLs; this is its fetch on this server.
    fetchImpl: (url, init) => fetch(base + url, init),
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}

const FORM = { address: "Wühlischstr. 30 10245", livingAreaSqm: "50", rooms: "2", askingRent: "700", buildingYear: "" };

test("save criteria from the form, reload them, then reset to the server's defaults", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  await saveListing({ fetchImpl, landlordId, request: listingRequest(FORM) });
  const before = await fetchDashboard({ fetchImpl, landlordId });
  const request = criteriaRequest({ ...criteriaFormValues(before.criteria), noSmoking: "on", affordability: "60" });
  const saved = await saveCriteria({ fetchImpl, landlordId, request });
  assert.equal(saved.dashboard.criteria.requirements.noSmoking, true);
  assert.notDeepEqual(saved.dashboard.ranked, before.ranked);
  assert.deepEqual(await fetchDashboard({ fetchImpl, landlordId }), saved.dashboard);
  const reset = await saveCriteria({ fetchImpl, landlordId, request: saved.dashboard.defaultCriteria });
  assert.deepEqual(reset.dashboard, before);
});

test("criteria validation reaches the form and an unknown landlord is signed out", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const result = await saveCriteria({ fetchImpl, landlordId, request: { requirements: { maxRentToIncome: 2 } } });
  assert.deepEqual(Object.keys(result.problems), ["requirements.maxRentToIncome"]);
  assert.equal(result.dashboard, undefined);
  assert.deepEqual(await saveCriteria({ fetchImpl, landlordId: "gone", request: {} }), { signedOut: true });
});

test("sign in, save the Listing from the form and read it back on the dashboard", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);

  const landlord = await signIn({ fetchImpl, name: "Erika Muster" });
  const saved = await saveListing({ fetchImpl, landlordId: landlord.landlordId, request: listingRequest(FORM) });
  const dashboard = await fetchDashboard({ fetchImpl, landlordId: landlord.landlordId });

  assert.equal(landlord.name, "Erika Muster");
  assert.equal(saved.listing.canonicalAddress.street, "Wühlischstraße");
  assert.equal(saved.listing.rentCheck.aboveCap, true);
  assert.deepEqual(dashboard.listing, saved.listing);
  assert.deepEqual(dashboard.rentCheck, saved.listing.rentCheck);
});

test("after saving the Listing the dashboard ranks the pool, and the table can filter it", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });

  const before = await fetchDashboard({ fetchImpl, landlordId });
  await saveListing({ fetchImpl, landlordId, request: listingRequest(FORM) });
  const after = await fetchDashboard({ fetchImpl, landlordId });

  assert.equal(before.hint.code, "listing_required");
  assert.deepEqual(before.ranked, []);
  assert.equal(after.hint, null);
  assert.ok(after.ranked.length > 0);
  assert.ok(after.ranked.every(({ name }) => typeof name === "string" && name));
  const complete = rankingRows(after.ranked, { completeOnly: true });
  assert.ok(complete.length > 0 && complete.length < after.ranked.length);
});

test("a ranked row can request its applicant detail with contact and the same score", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  await saveListing({ fetchImpl, landlordId, request: listingRequest(FORM) });
  const dashboard = await fetchDashboard({ fetchImpl, landlordId });
  const row = rankingRows(dashboard.ranked)[0];

  const detail = await fetchApplicantProfile({ fetchImpl, landlordId, applicantId: row.applicantId });

  assert.equal(detail.profile.id, row.applicantId);
  assert.equal(detail.score.matchScore, row.matchScore);
  assert.equal(detail.score.rentToIncome, row.rentToIncome);
  assert.deepEqual(detail.score.breakdown, row.breakdown);
  assert.ok(detail.contact.name && detail.contact.email && detail.contact.phone);
  assert.equal((await fetchApplicantProfile({ fetchImpl, landlordId, applicantId: "absent" })).notFound, true);
});

test("an applicant profile shows the score under the landlord's saved criteria", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  await saveListing({ fetchImpl, landlordId, request: listingRequest(FORM) });
  const before = await fetchDashboard({ fetchImpl, landlordId });
  const applicantId = "A-001";
  await saveCriteria({ fetchImpl, landlordId, request: { weights: { affordability: 130 } } });
  const after = await fetchDashboard({ fetchImpl, landlordId });
  const profile = await fetchApplicantProfile({ fetchImpl, landlordId, applicantId });

  assert.equal(profile.score.matchScore, after.ranked.find(({ applicantId: id }) => id === applicantId).matchScore);
  assert.notEqual(profile.score.matchScore, before.ranked.find(({ applicantId: id }) => id === applicantId).matchScore);
});

test("with a Listing saved, the page opens with the pool summary, the stat tiles and the Recommendation cards", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  await saveListing({ fetchImpl, landlordId, request: listingRequest(FORM) });

  const dashboard = await fetchDashboard({ fetchImpl, landlordId });

  assert.match(poolSummary(dashboard.stats), /^Sie haben 40 Bewerber, \d+ können sich diese Miete leisten\.$/);
  const tiles = statTiles(dashboard.stats);
  assert.equal(tiles.length, 6);
  assert.ok(tiles.every(({ available }) => available));
  const cards = recommendationCards(dashboard.recommendations);
  assert.deepEqual(cards.map(({ applicantId }) => applicantId), dashboard.ranked.slice(0, 2).map(({ applicantId }) => applicantId));
  assert.ok(cards.every(({ name, reason }) => name && reason.startsWith("Dieser Bewerber könnte Ihnen gefallen: ")));
});

test("form fields the server rejects come back as problems by field", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });

  const result = await saveListing({ fetchImpl, landlordId, request: listingRequest({ ...FORM, livingAreaSqm: "fifty" }) });

  assert.deepEqual(Object.keys(result.problems), ["livingAreaSqm"]);
  assert.equal(result.listing, undefined);
});

test("a landlord the server does not know (e.g. a new database) is signed out", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);

  assert.deepEqual(await fetchDashboard({ fetchImpl, landlordId: "gone" }), { signedOut: true });
  assert.deepEqual(await saveListing({ fetchImpl, landlordId: "gone", request: listingRequest(FORM) }), { signedOut: true });
});

test("an empty name is refused with a readable reason", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);

  await assert.rejects(signIn({ fetchImpl, name: "  " }), (error) => error.message && !error.message.includes("{"));
});

test("a server that cannot be reached is an error with a readable reason", async () => {
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(signIn({ fetchImpl: down, name: "Erika" }), /./);
  await assert.rejects(fetchDashboard({ fetchImpl: down, landlordId: "l-1" }), /./);
  await assert.rejects(saveListing({ fetchImpl: down, landlordId: "l-1", request: {} }), /./);
});

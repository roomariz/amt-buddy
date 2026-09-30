import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { fetchOverview, removeRating, removeShortlistEntry, saveRating, saveShortlistEntry, signIn } from "../../public/landlord/api.js";
import { fillSlots } from "../../public/landlord/board.js";

// The chat-first page's data against the real app (docs/plan/2026-09-30-landlord-chat-first.md).

async function start() {
  const app = createApp({
    env: {},
    landlordStore: createLandlordStore({ path: ":memory:" }),
    fetchImpl: createFakeBerlinWfs().fetchImpl,
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return {
    fetchImpl: (url, init) => fetch(base + url, init),
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}

test("right after sign-in, before any flat details, the overview already ranks the pool with names", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const overview = await fetchOverview({ fetchImpl, landlordId });
  assert.ok(overview.ranked.length >= 2, "at least two applicants to fill the slots");
  for (const entry of overview.ranked) {
    assert.equal(typeof entry.name, "string");
    assert.ok(["single", "couple", "family", "group"].includes(entry.householdShape));
  }
  assert.deepEqual(overview.inactive.find(({ criterion }) => criterion === "affordability"), { criterion: "affordability", missing: ["askingRent"] });
  assert.deepEqual(overview.shortlist, []);
});

test("shortlisting from a slot: the Shortlist gains the applicant and the slot refills from the rest", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const before = await fetchOverview({ fetchImpl, landlordId });
  // random 0: the best candidates, so the refill is predictable.
  const slots = fillSlots({ ranked: before.ranked, random: () => 0 });
  const [first, second] = slots;

  await saveShortlistEntry({ fetchImpl, landlordId, applicantId: first, status: "to_invite" });
  const after = await fetchOverview({ fetchImpl, landlordId });
  assert.deepEqual(after.shortlist.map(({ applicantId }) => applicantId), [first]);
  const hidden = new Set(after.shortlist.map(({ applicantId }) => applicantId));
  const refilled = fillSlots({ ranked: after.ranked, current: slots, hidden, random: () => 0 });
  assert.equal(refilled[1], second, "the other slot stays put");
  assert.notEqual(refilled[0], first);
  assert.equal(refilled[0], after.ranked.map(({ applicantId }) => applicantId).find((id) => id !== first && id !== second));

  await removeShortlistEntry({ fetchImpl, landlordId, applicantId: first });
  assert.deepEqual((await fetchOverview({ fetchImpl, landlordId })).shortlist, []);
});

test("an unknown landlord is signed out", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  assert.deepEqual(await fetchOverview({ fetchImpl, landlordId: "gone" }), { signedOut: true });
});

test("a thumbs up adds the landlord's bonus to the ranking; clicking again removes it (Round 2)", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const before = await fetchOverview({ fetchImpl, landlordId });
  assert.equal(before.bonusPoints, 5, "5 points by default");
  // The 7th-ranked applicant, rated up, gains 5 points on the ranking; the Match score stays objective.
  const seventh = before.ranked[6];
  assert.equal(seventh.rating, null);
  assert.equal(seventh.bonus, 0);

  assert.deepEqual(await saveRating({ fetchImpl, landlordId, applicantId: seventh.applicantId, rating: "up" }), { rating: "up" });
  const rated = (await fetchOverview({ fetchImpl, landlordId })).ranked.find(({ applicantId }) => applicantId === seventh.applicantId);
  assert.equal(rated.rating, "up");
  assert.equal(rated.bonus, 5);
  assert.equal(rated.matchScore, seventh.matchScore);

  assert.deepEqual(await removeRating({ fetchImpl, landlordId, applicantId: seventh.applicantId }), { rating: null });
  const reverted = (await fetchOverview({ fetchImpl, landlordId })).ranked.find(({ applicantId }) => applicantId === seventh.applicantId);
  assert.equal(reverted.rating, null);
  assert.equal(reverted.bonus, 0);
  assert.equal(reverted.rank, seventh.rank);
});

test("a thumbs down: rating down and a negative bonus; unknown applicant and unknown landlord", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const [first] = (await fetchOverview({ fetchImpl, landlordId })).ranked;
  assert.deepEqual(await saveRating({ fetchImpl, landlordId, applicantId: first.applicantId, rating: "down" }), { rating: "down" });
  const rated = (await fetchOverview({ fetchImpl, landlordId })).ranked.find(({ applicantId }) => applicantId === first.applicantId);
  assert.equal(rated.rating, "down");
  assert.equal(rated.bonus, -5);
  assert.deepEqual(await saveRating({ fetchImpl, landlordId, applicantId: "A-999", rating: "up" }), { notFound: true });
  assert.deepEqual(await saveRating({ fetchImpl, landlordId: "gone", applicantId: first.applicantId, rating: "up" }), { signedOut: true });
  assert.deepEqual(await removeRating({ fetchImpl, landlordId: "gone", applicantId: first.applicantId }), { signedOut: true });
});

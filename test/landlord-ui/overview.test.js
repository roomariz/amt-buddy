import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { fetchOverview, removeShortlistEntry, saveShortlistEntry, signIn } from "../../public/landlord/api.js";
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
  const slots = fillSlots({ ranked: before.ranked });
  const [first, second] = slots;

  await saveShortlistEntry({ fetchImpl, landlordId, applicantId: first, status: "to_invite" });
  const after = await fetchOverview({ fetchImpl, landlordId });
  assert.deepEqual(after.shortlist.map(({ applicantId }) => applicantId), [first]);
  const hidden = new Set(after.shortlist.map(({ applicantId }) => applicantId));
  const refilled = fillSlots({ ranked: after.ranked, current: slots, hidden });
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

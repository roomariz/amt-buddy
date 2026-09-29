// The /landlord page's client code (public/landlord/*.js) against the real server (src/app.js):
// the same calls the page makes, with the Berlin WFS faked and an in-memory landlord store.
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { fetchDashboard, saveListing, signIn } from "../../public/landlord/api.js";
import { listingRequest } from "../../public/landlord/listing.js";

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

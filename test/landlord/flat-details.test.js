// The flat details: what the landlord said about the flat so far, saved partially; once the
// address, size, rooms and rent are all known, the full Listing with its Rent check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { updateFlatDetails } from "../../src/landlord/flat-details.js";
import { buildListing, ListingInputError } from "../../src/landlord/listing.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";

const NOTHING = { address: null, livingAreaSqm: null, rooms: null, askingRent: null, buildingYear: null };

function setup(wfs = {}) {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Erika Muster");
  const { fetchImpl } = createFakeBerlinWfs(wfs);
  const update = (input) => updateFlatDetails({ store, landlordId, input, fetchImpl });
  return { store, landlordId, update, fetchImpl };
}

test("a new landlord has no flat details; a Listing saved on the classic page seeds them", async () => {
  const { store, landlordId, fetchImpl } = setup();
  assert.deepEqual(store.getFlatDetails(landlordId), NOTHING);

  const listing = await buildListing({ address: " Wühlischstraße 30, 10245 Berlin ", livingAreaSqm: 50, rooms: 2, askingRent: 700, buildingYear: 1905 }, { fetchImpl });
  store.saveListing(landlordId, listing);

  assert.deepEqual(store.getFlatDetails(landlordId), {
    address: "Wühlischstraße 30, 10245 Berlin",
    livingAreaSqm: 50,
    rooms: 2,
    askingRent: 700,
    buildingYear: 1905,
  });
});

test("flat details are saved as they come; nothing is built while one of the four is missing", async () => {
  const { store, landlordId, update } = setup();

  const first = await update({ askingRent: 1100 });
  assert.deepEqual(first.flat, { ...NOTHING, askingRent: 1100 });
  assert.deepEqual(first.missing, ["address", "livingAreaSqm", "rooms"]);
  assert.equal(first.listing, null);

  const second = await update({ livingAreaSqm: 65, rooms: 2 });
  assert.deepEqual(second.flat, { ...NOTHING, askingRent: 1100, livingAreaSqm: 65, rooms: 2 });
  assert.deepEqual(second.missing, ["address"]);
  assert.equal(second.listing, null);

  assert.deepEqual(store.getFlatDetails(landlordId), second.flat);
  assert.equal(store.getListing(landlordId), null);
});

test("once address, size, rooms and rent are known the full Listing with its Rent check is built and saved", async () => {
  const { store, landlordId, update } = setup();
  await update({ livingAreaSqm: 50, rooms: 2, askingRent: 700 });

  const { flat, missing, listing } = await update({ address: "Wühlischstraße 30, 10245 Berlin" });

  assert.deepEqual(missing, []);
  assert.deepEqual(flat, { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 50, rooms: 2, askingRent: 700, buildingYear: null });
  // Wühlischstraße 30 (fake WFS): 420 / 490 / 610 € for 50 m², Mietspiegel + 10 % = 539 €.
  assert.equal(listing.addressVerified, true);
  assert.deepEqual(listing.rentCheck.range, { lower: 420, median: 490, upper: 610 });
  assert.equal(listing.rentCheck.allowedRent, 539);
  assert.deepEqual(store.getListing(landlordId), listing);
  assert.deepEqual(store.getFlatDetails(landlordId), flat);
});

test("a changed fact rebuilds the Listing and its Rent check", async () => {
  const { store, landlordId, update } = setup();
  await update({ address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 50, rooms: 2, askingRent: 700 });

  const { listing } = await update({ askingRent: 500 });

  assert.equal(listing.askingRent, 500);
  assert.equal(listing.rentCheck.askingRent, 500);
  assert.equal(listing.rentCheck.position, "typical");
  assert.equal(store.getListing(landlordId).askingRent, 500);
});

test("a value the Listing form would refuse is an input error with its message, and nothing is saved", async () => {
  const { store, landlordId, update } = setup();
  await update({ rooms: 2 });

  for (const [input, pattern] of [
    [{ askingRent: 1100, livingAreaSqm: 0 }, /'livingAreaSqm' must be a number of m² above 0 and at most 1000/],
    [{ askingRent: -5 }, /'askingRent' must be a monthly net cold rent/],
    [{ buildingYear: 1600 }, /'buildingYear' must be a year between 1800/],
    [{ address: "Wühlischstraße 30", askingRent: 1100 }, /street, house number and postal code/],
    [{}, /at least one/],
  ]) {
    await assert.rejects(update(input), (error) => error instanceof ListingInputError && pattern.test(JSON.stringify(error.details)), JSON.stringify(input));
    assert.deepEqual(store.getFlatDetails(landlordId), { ...NOTHING, rooms: 2 }, JSON.stringify(input));
  }
});

test("an address the register does not know: the details and the Listing are saved without a Rent check, with the note why", async () => {
  const { store, landlordId, update } = setup();

  const { flat, listing } = await update({ address: "Erfundene Straße 1, 10245 Berlin", livingAreaSqm: 50, rooms: 2, askingRent: 700 });

  assert.equal(flat.address, "Erfundene Straße 1, 10245 Berlin");
  assert.equal(listing.rentCheck, null);
  assert.equal(listing.note.code, "address_not_verified");
  assert.deepEqual(store.getFlatDetails(landlordId), flat);
  assert.equal(store.getListing(landlordId).note.code, "address_not_verified");
});

test("the flat details are per landlord", async () => {
  const { store, update } = setup();
  const other = store.signIn("Max Mustermann").landlordId;
  await update({ askingRent: 1100 });
  assert.deepEqual(store.getFlatDetails(other), NOTHING);
});

test("a Listing saved before the flat details existed seeds them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-flat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");
  const { fetchImpl } = createFakeBerlinWfs();
  const listing = await buildListing({ address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 50, rooms: 2, askingRent: 700, buildingYear: 1905 }, { fetchImpl });
  const before = createLandlordStore({ path });
  const { landlordId } = before.signIn("Erika Muster");
  before.saveListing(landlordId, listing);
  before.close();
  // The database as an older store left it: the Listing, no flat_details row.
  const db = new DatabaseSync(path);
  db.prepare("DELETE FROM flat_details WHERE landlord_id = ?").run(landlordId);
  db.close();

  const store = createLandlordStore({ path });
  try {
    assert.deepEqual(store.getFlatDetails(landlordId), {
      address: "Wühlischstraße 30, 10245 Berlin",
      livingAreaSqm: 50,
      rooms: 2,
      askingRent: 700,
      buildingYear: 1905,
    });
  } finally {
    store.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import { forgetLandlord, LANDLORD_KEY, rememberLandlord, storedLandlord } from "../../public/landlord/session.js";

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

const ERIKA = { landlordId: "l-1", name: "Erika Muster" };

test("a first visit has no signed-in landlord", () => {
  assert.equal(storedLandlord(memoryStorage()), null);
});

test("a signed-in landlord is remembered across reloads", () => {
  const storage = memoryStorage();
  rememberLandlord(storage, ERIKA);
  assert.deepEqual(storedLandlord(storage), ERIKA);
});

test("signing out forgets the landlord", () => {
  const storage = memoryStorage();
  rememberLandlord(storage, ERIKA);
  forgetLandlord(storage);
  assert.equal(storedLandlord(storage), null);
});

test("an unusable stored value counts as signed out", () => {
  for (const value of ["not json", "null", '{"name":"x"}', '{"landlordId":"","name":"x"}', "[1]"]) {
    assert.equal(storedLandlord(memoryStorage({ [LANDLORD_KEY]: value })), null, value);
  }
});

test("without working storage nothing is remembered and nothing throws", () => {
  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  rememberLandlord(broken, ERIKA);
  forgetLandlord(broken);
  assert.equal(storedLandlord(broken), null);
  assert.equal(storedLandlord(null), null);
});

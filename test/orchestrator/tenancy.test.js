import test from "node:test";
import assert from "node:assert/strict";

import { confirmedValues, factsFromConfirm, isUnconfirmed, mergeTenancy, tenancyReducer } from "../../src/orchestrator/tenancy.js";

test("a user statement beats an extracted lease value", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "livingAreaSqm", value: 50, source: "lease", confidence: 0.92 },
    { fact: "livingAreaSqm", value: 52, source: "user" },
  ]);
  assert.deepEqual(tenancy.livingAreaSqm, { value: 52, source: "user" });
});

test("a later lease value does not overwrite a user statement", () => {
  const tenancy = mergeTenancy({ contractRent: { value: 720, source: "user" } }, [
    { fact: "contractRent", value: 780, source: "lease", confidence: 0.99 },
  ]);
  assert.equal(tenancy.contractRent.value, 720);
});

test("the most recent user statement wins", () => {
  const tenancy = mergeTenancy({ contractRent: { value: 780, source: "user" } }, [
    { fact: "contractRent", value: "720", source: "user" },
  ]);
  assert.deepEqual(tenancy.contractRent, { value: 720, source: "user" });
});

test("a lease building year beats the official block estimate", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "buildingYear", value: "1950 - 1959", source: "official" },
    { fact: "buildingYear", value: 1935, source: "lease", confidence: 0.9 },
  ]);
  assert.equal(tenancy.buildingYear.value, 1935);
  const reversed = mergeTenancy(tenancy, [{ fact: "buildingYear", value: "1950 - 1959", source: "official" }]);
  assert.equal(reversed.buildingYear.value, 1935);
});

test("the Canonical address replaces the typed address and remembers who stated it", () => {
  const tenancy = mergeTenancy({ address: { value: "Berliner Str. 155", source: "user" } }, [
    { fact: "address", value: "Berliner Straße 155, 10715 Berlin", source: "official" },
    { fact: "residentialLocation", value: "gut", source: "official" },
  ]);
  assert.deepEqual(tenancy.address, {
    value: "Berliner Straße 155, 10715 Berlin",
    source: "official",
    statedBy: "user",
  });
  assert.equal(tenancy.residentialLocation.value, "gut");
});

test("a newly stated address clears facts derived from the old one", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    coordinates: { value: { longitude: 13.3, latitude: 52.4 }, source: "official" },
    residentialLocation: { value: "gut", source: "official" },
    buildingYear: { value: "1921 - 1930", source: "official" },
    livingAreaSqm: { value: 50, source: "user" },
  };
  const after = mergeTenancy(before, [{ fact: "address", value: "Karl-Marx-Allee 1", source: "user" }]);
  assert.deepEqual(Object.keys(after).sort(), ["address", "livingAreaSqm"]);
  assert.deepEqual(after.address, { value: "Karl-Marx-Allee 1", source: "user" });
});

test("a newly verified different address clears facts derived from the old one", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    coordinates: { value: { longitude: 13.3, latitude: 52.4 }, source: "official" },
    buildingYear: { value: 1935, source: "lease", confidence: 0.9 },
  };
  const after = mergeTenancy(before, [{ fact: "address", value: "Karl-Marx-Allee 1, 10178 Berlin", source: "official" }]);
  assert.deepEqual(after, {
    address: { value: "Karl-Marx-Allee 1, 10178 Berlin", source: "official", statedBy: "user" },
    buildingYear: { value: 1935, source: "lease", confidence: 0.9 },
  });
});

test("restating the canonical address keeps derived facts", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    residentialLocation: { value: "gut", source: "official" },
  };
  const after = mergeTenancy(before, [
    { fact: "address", value: "Berliner Straße 155, 10715 Berlin", source: "user" },
  ]);
  assert.equal(after.residentialLocation.value, "gut");
});

test("a lease address neither replaces a user-stated canonical address nor clears its facts", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    residentialLocation: { value: "gut", source: "official" },
  };
  const after = mergeTenancy(before, [{ fact: "address", value: "Hauptstr. 1", source: "lease", confidence: 0.9 }]);
  assert.deepEqual(after, before);
});

test("numeric facts accept German decimals and ignore unparsable values", () => {
  const tenancy = mergeTenancy({ occupants: { value: 2, source: "user" } }, [
    { fact: "contractRent", value: "720,50", source: "user" },
    { fact: "livingAreaSqm", value: "1.234,5", source: "user" },
    { fact: "occupants", value: "abc", source: "user" },
    { fact: "rooms", value: "2 1/2", source: "user" },
  ]);
  assert.deepEqual(tenancy, {
    occupants: { value: 2, source: "user" },
    contractRent: { value: 720.5, source: "user" },
    livingAreaSqm: { value: 1234.5, source: "user" },
  });
});

test("unknown facts and empty values are ignored; null resets the Tenancy", () => {
  const tenancy = tenancyReducer({}, [
    { fact: "petName", value: "Rex", source: "user" },
    { fact: "rooms", value: "", source: "user" },
    { fact: "address", value: "   ", source: "user" },
    { fact: "contractRent", value: null, source: "user" },
  ]);
  assert.deepEqual(tenancy, {});
  assert.deepEqual(tenancyReducer({ rooms: { value: 2, source: "user" } }, null), {});
});

test("a lease fact below 0.8 confidence is unconfirmed and not among the confirmed values", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "contractRent", value: 780, source: "lease", confidence: 0.6 },
    { fact: "livingAreaSqm", value: 50, source: "lease", confidence: 0.8 },
    { fact: "rooms", value: 2, source: "user" },
  ]);
  assert.equal(isUnconfirmed(tenancy.contractRent), true);
  assert.equal(isUnconfirmed(tenancy.livingAreaSqm), false);
  assert.deepEqual(confirmedValues(tenancy), { livingAreaSqm: 50, rooms: 2 });
});

test("confirming or correcting an Unconfirmed fact makes it the user's; unknown keys are ignored", () => {
  let tenancy = mergeTenancy({}, [
    { fact: "contractRent", value: 780, source: "lease", confidence: 0.6 },
    { fact: "rooms", value: 3, source: "lease", confidence: 0.5 },
  ]);
  tenancy = mergeTenancy(tenancy, factsFromConfirm({ contractRent: 780, rooms: "2", residentialLocation: "gut" }));
  assert.deepEqual(tenancy, {
    contractRent: { value: 780, source: "user" },
    rooms: { value: 2, source: "user" },
  });
  assert.deepEqual(confirmedValues(tenancy), { contractRent: 780, rooms: 2 });
});

test("a lease fact without a numeric confidence is unconfirmed", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "contractRent", value: 780, source: "lease", confidence: "high" },
    { fact: "rooms", value: 2, source: "lease", confidence: Number.NaN },
    { fact: "livingAreaSqm", value: 50, source: "lease" },
  ]);
  assert.deepEqual(confirmedValues(tenancy), {});
});

test("a lease address never replaces a Canonical address, even one the lease stated", () => {
  let tenancy = mergeTenancy({}, [{ fact: "address", value: "Berliner Str. 155", source: "lease", confidence: 0.95 }]);
  tenancy = mergeTenancy(tenancy, [
    { fact: "address", value: "Berliner Straße 155, 10715 Berlin", source: "official" },
    { fact: "residentialLocation", value: "gut", source: "official" },
  ]);
  const after = mergeTenancy(tenancy, [{ fact: "address", value: "Berliner Str. 155", source: "lease", confidence: 0.95 }]);
  assert.deepEqual(after, tenancy);
});

test("a building year is a year or an official period; anything else is ignored", () => {
  const tenancy = mergeTenancy({}, [{ fact: "buildingYear", value: "1935", source: "user" }]);
  assert.deepEqual(tenancy.buildingYear, { value: 1935, source: "user" });
  assert.deepEqual(mergeTenancy(tenancy, [{ fact: "buildingYear", value: "abc", source: "user" }]), tenancy);
  assert.deepEqual(mergeTenancy(tenancy, [{ fact: "buildingYear", value: 19.5, source: "user" }]), tenancy);
  const official = mergeTenancy({}, [{ fact: "buildingYear", value: "1921 - 1930", source: "official" }]);
  assert.equal(official.buildingYear.value, "1921 - 1930");
});

const RATINGS = {
  bathroomRating: { value: "positive", source: "user" },
  kitchenRating: { value: "neutral", source: "user" },
  apartmentRating: { value: "positive", source: "user" },
  buildingRating: { value: "negative", source: "user" },
  surroundingsRating: { value: "positive", source: "user" },
};

test("feature group ratings are stated facts that take only positive, neutral or negative", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "bathroomRating", value: "positive", source: "user" },
    { fact: "kitchenRating", value: " Negative ", source: "user" },
    { fact: "apartmentRating", value: "better", source: "user" },
    { fact: "buildingRating", value: 1, source: "user" },
  ]);
  assert.deepEqual(tenancy, {
    bathroomRating: { value: "positive", source: "user" },
    kitchenRating: { value: "negative", source: "user" },
  });
  assert.deepEqual(factsFromConfirm({ surroundingsRating: "neutral" }), [
    { fact: "surroundingsRating", value: "neutral", source: "user" },
  ]);
});

test("a newly stated or verified different address clears the feature group ratings", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    ...RATINGS,
  };
  const stated = mergeTenancy(before, [{ fact: "address", value: "Karl-Marx-Allee 1", source: "user" }]);
  assert.deepEqual(Object.keys(stated), ["address"]);
  const verified = mergeTenancy(before, [{ fact: "address", value: "Karl-Marx-Allee 1, 10178 Berlin", source: "official" }]);
  assert.deepEqual(Object.keys(verified), ["address"]);
});

test("feature group ratings survive the first address and its verification", () => {
  const stated = mergeTenancy(RATINGS, [{ fact: "address", value: "Berliner Str. 155", source: "user" }]);
  const verified = mergeTenancy(stated, [
    { fact: "address", value: "Berliner Straße 155, 10715 Berlin", source: "official" },
  ]);
  assert.deepEqual(verified, {
    ...RATINGS,
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
  });
});

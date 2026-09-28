import test from "node:test";
import assert from "node:assert/strict";

import { confidenceLevel, confirmPayload, reviewCard } from "../../public/chat/tenancy.js";

test("confidence maps to green, yellow and red at the Unconfirmed-fact threshold", () => {
  assert.equal(confidenceLevel(0.95), "high");
  assert.equal(confidenceLevel(0.8), "high");
  assert.equal(confidenceLevel(0.79), "medium");
  assert.equal(confidenceLevel(0.6), "medium");
  assert.equal(confidenceLevel(0.5), "low");
  assert.equal(confidenceLevel(undefined), "low");
  assert.equal(confidenceLevel("0.9"), "low");
});

const lease = {
  address: { value: "Wühlischstraße 30, 10245 Berlin", source: "official", statedBy: "lease" },
  contractRent: { value: 30000, source: "lease", confidence: 0.5 },
  livingAreaSqm: { value: 60.5, source: "lease", confidence: 0.95 },
  rooms: { value: 2, source: "user" },
  residentialLocation: { value: "gut", source: "official" },
};

test("no review card while every lease value is confirmed", () => {
  assert.equal(reviewCard({}), null);
  assert.equal(reviewCard(undefined), null);
  assert.equal(
    reviewCard({ contractRent: { value: 780, source: "lease", confidence: 0.95 }, rooms: { value: 2, source: "user" } }),
    null,
  );
});

test("the review card lists the lease's values, Unconfirmed facts first, with German labels", () => {
  const card = reviewCard(lease);
  assert.deepEqual(card.fields, [
    {
      name: "contractRent",
      label: "Nettokaltmiete",
      unit: "€ / Monat",
      value: "30000",
      confidence: 0.5,
      level: "low",
      unconfirmed: true,
    },
    {
      name: "livingAreaSqm",
      label: "Wohnfläche",
      unit: "m²",
      value: "60,5",
      confidence: 0.95,
      level: "high",
      unconfirmed: false,
    },
  ]);
});

test("a lease value without a numeric confidence is Unconfirmed", () => {
  const card = reviewCard({ buildingYear: { value: 1905, source: "lease" } });
  assert.equal(card.fields[0].unconfirmed, true);
  assert.equal(card.fields[0].level, "low");
});

test("confirm sends every Unconfirmed value and only the confirmed values the user changed", () => {
  const { fields } = reviewCard(lease);
  assert.deepEqual(confirmPayload(fields, { contractRent: " 780,50 ", livingAreaSqm: "60,5" }), {
    contractRent: "780,50",
  });
  assert.deepEqual(confirmPayload(fields, { contractRent: "30000", livingAreaSqm: "62" }), {
    contractRent: "30000",
    livingAreaSqm: "62",
  });
});

test("an Unconfirmed value left empty is not sent", () => {
  const { fields } = reviewCard(lease);
  assert.deepEqual(confirmPayload(fields, { contractRent: "  ", livingAreaSqm: "60,5" }), {});
});

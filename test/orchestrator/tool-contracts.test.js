import test from "node:test";
import assert from "node:assert/strict";

import { assertToolsMatchContracts, TOOL_CONTRACTS, TOOL_NAMES } from "../../src/orchestrator/tool-contracts.js";
import { createStubTools } from "../../src/orchestrator/stub-tools.js";

const SAMPLE_ARGS = {
  validate_berlin_address: { address: "Berliner Straße 155, 10715 Berlin" },
  lookup_building_age: { longitude: 13.3295, latitude: 52.4872 },
  calculate_mietspiegel: { residentialLocation: "gut", buildingAgeOrYear: 1935, livingAreaSqm: 50, contractRent: 500 },
  assess_occupancy_compliance: { livingAreaSqm: 50, rooms: 2, occupants: 2, childrenUpToSix: 0 },
  extract_lease_data: { documentId: "doc-1" },
};

test("stub tools satisfy every tool contract", async () => {
  const { tools } = createStubTools();
  const byName = assertToolsMatchContracts(tools);
  assert.deepEqual(TOOL_NAMES.toSorted(), Object.keys(SAMPLE_ARGS).toSorted());
  for (const name of TOOL_NAMES) {
    assert.doesNotThrow(() => TOOL_CONTRACTS[name].schema.parse(SAMPLE_ARGS[name]), name);
    const result = await byName.get(name).invoke(SAMPLE_ARGS[name]);
    assert.doesNotThrow(() => TOOL_CONTRACTS[name].output.parse(result), name);
  }
});

test("rejects a tool set with a missing tool, naming it", () => {
  const { tools } = createStubTools();
  assert.throws(
    () => assertToolsMatchContracts(tools.filter((t) => t.name !== "calculate_mietspiegel")),
    /missing required tools: calculate_mietspiegel/,
  );
});

test("stub overrides replace a handler and calls are recorded", async () => {
  const { tools, calls } = createStubTools({ validate_berlin_address: () => ({ verified: false, address: null }) });
  const byName = assertToolsMatchContracts(tools);
  assert.deepEqual(await byName.get("validate_berlin_address").invoke({ address: "Nowhere 1" }), {
    verified: false,
    address: null,
  });
  assert.deepEqual(calls, [{ name: "validate_berlin_address", args: { address: "Nowhere 1" } }]);
});

test("calculate_mietspiegel takes optional feature group ratings, all five or none", async () => {
  const { schema, output } = TOOL_CONTRACTS.calculate_mietspiegel;
  const base = { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50 };
  const featureGroups = {
    bathroom: "positive",
    kitchen: "positive",
    apartment: "neutral",
    building: "negative",
    surroundings: "positive",
  };

  assert.doesNotThrow(() => schema.parse(base), "the ratings are optional");
  assert.deepEqual(schema.parse({ ...base, featureGroups }).featureGroups, featureGroups);
  const { surroundings, ...fourGroups } = featureGroups;
  assert.throws(() => schema.parse({ ...base, featureGroups: fourGroups }), "all five groups or none");
  assert.throws(() => schema.parse({ ...base, featureGroups: { ...featureGroups, kitchen: "better" } }));

  const { tools } = createStubTools();
  const result = await assertToolsMatchContracts(tools).get("calculate_mietspiegel").invoke({ ...base, featureGroups });
  assert.doesNotThrow(() => output.parse(result));
  // 50 m², gut, 1919–1949: 8.20 / 9.45 / 11.10 €/m². Three positive, one negative: +40 % of the
  // upper span, 9.45 + 0.4 × 1.65 €/m² and 472.50 + 0.4 × 82.50 € a month.
  assert.deepEqual(result.adjustedReferenceRent, { weightPercent: 40, rentPerSqm: 10.11, monthlyRent: 505.5 });
});

test("calculate_mietspiegel takes an optional 'rented before' and then adds a rent cap", async () => {
  const { schema, output } = TOOL_CONTRACTS.calculate_mietspiegel;
  const base = { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50, contractRent: 780 };

  assert.equal(schema.parse({ ...base, rentedBefore: false }).rentedBefore, false);
  assert.throws(() => schema.parse({ ...base, rentedBefore: "yes" }), "a boolean, not text");

  const { tools } = createStubTools();
  const result = await assertToolsMatchContracts(tools).get("calculate_mietspiegel").invoke({ ...base, rentedBefore: true });
  assert.doesNotThrow(() => output.parse(result));
  assert.equal(result.rentCap.capMonthlyRent, 519.75);
});

test("calculate_mietspiegel takes an optional previous rent, which can become the rent cap", async () => {
  const { schema, output } = TOOL_CONTRACTS.calculate_mietspiegel;
  const base = { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50, contractRent: 780, rentedBefore: true };

  assert.doesNotThrow(() => schema.parse(base), "the previous rent is optional");
  assert.equal(schema.parse({ ...base, previousRent: 950.5 }).previousRent, 950.5);
  assert.throws(() => schema.parse({ ...base, previousRent: 0 }), "a positive amount");

  const { tools } = createStubTools();
  const result = await assertToolsMatchContracts(tools).get("calculate_mietspiegel").invoke({ ...base, previousRent: 950 });
  assert.doesNotThrow(() => output.parse(result));
  assert.equal(result.rentCap.basis, "previous_rent");
  assert.equal(result.rentCap.capMonthlyRent, 950);
});

test("calculate_mietspiegel takes an optional 'first used after 2014', which exempts a flat never rented", async () => {
  const { schema, output } = TOOL_CONTRACTS.calculate_mietspiegel;
  const base = { residentialLocation: "gut", buildingAgeOrYear: 2016, livingAreaSqm: 50, contractRent: 780, rentedBefore: false };

  assert.doesNotThrow(() => schema.parse(base), "'first used after 2014' is optional");
  assert.equal(schema.parse({ ...base, firstUsedAfter2014: true }).firstUsedAfter2014, true);
  assert.throws(() => schema.parse({ ...base, firstUsedAfter2014: "yes" }), "a boolean, not text");

  const { tools } = createStubTools();
  const result = await assertToolsMatchContracts(tools).get("calculate_mietspiegel").invoke({ ...base, firstUsedAfter2014: true });
  assert.doesNotThrow(() => output.parse(result));
  assert.equal(result.rentCap.status, "exempt");
  assert.equal(result.rentCap.capMonthlyRent, null);
});

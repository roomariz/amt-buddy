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

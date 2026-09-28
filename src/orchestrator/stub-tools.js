import { tool } from "@langchain/core/tools";

import { evaluateMietspiegel } from "../berlin-mietspiegel.js";
import { assessOccupancy } from "../occupancy-assessment.js";
import { TOOL_CONTRACTS } from "./tool-contracts.js";

const DEFAULT_HANDLERS = {
  validate_berlin_address: () => ({
    verified: true,
    address: {
      street: "Berliner Straße",
      houseNumber: "155",
      postalCode: "10715",
      district: "Charlottenburg-Wilmersdorf",
      coordinates: { longitude: 13.3295, latitude: 52.4872 },
      residentialLocation: "gut",
    },
  }),
  lookup_building_age: () => ({ predominantConstructionPeriod: "1921 - 1930" }),
  calculate_mietspiegel: (args) => evaluateMietspiegel(args),
  assess_occupancy_compliance: (args) => assessOccupancy(args),
  extract_lease_data: () => ({
    fields: {
      address: { value: "Berliner Straße 155, 10715 Berlin", confidence: 0.95 },
      contractRent: { value: 780, confidence: 0.6 },
      livingAreaSqm: { value: 50, confidence: 0.92 },
      rooms: { value: 2, confidence: 0.9 },
    },
  }),
};

// Contract-conforming fake Tools for tests and for running the Orchestrator
// before the real Tools exist. `overrides` replaces a handler by tool name.
export function createStubTools(overrides = {}) {
  const calls = [];
  const tools = Object.values(TOOL_CONTRACTS).map((contract) => {
    const handler = overrides[contract.name] ?? DEFAULT_HANDLERS[contract.name];
    return tool(
      async (args) => {
        calls.push({ name: contract.name, args });
        return handler(args);
      },
      { name: contract.name, description: contract.description, schema: contract.schema },
    );
  });
  return { tools, calls };
}

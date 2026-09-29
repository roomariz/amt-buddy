import test from "node:test";
import assert from "node:assert/strict";

import {
  createLandlordOrchestrator,
  createLandlordStubTools,
  LANDLORD_TOOL_CONTRACTS,
  LANDLORD_TOOL_NAMES,
} from "../../src/landlord/orchestrator/index.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";

// Arguments a model could send to each Tool.
const SAMPLE_ARGS = {
  get_ranking: {},
  get_applicant_profile: { applicantId: "A-001" },
  update_selection_criteria: { requirements: { schufaCleanOnly: true } },
  adjust_selection_criteria: { changes: [{ criterion: "employment", factor: 1.3 }] },
  update_flat_details: { askingRent: 1100, livingAreaSqm: 65, rooms: 2 },
  remember_preference: { note: "I'd like someone who stays long-term." },
  update_shortlist: { applicantId: "A-001", status: "to_invite", note: "Stable income" },
  get_rent_check: {},
};

test("the eight landlord Tools have contracts", () => {
  assert.deepEqual(LANDLORD_TOOL_NAMES.sort(), [
    "adjust_selection_criteria",
    "get_applicant_profile",
    "get_ranking",
    "get_rent_check",
    "remember_preference",
    "update_flat_details",
    "update_selection_criteria",
    "update_shortlist",
  ]);
  for (const name of LANDLORD_TOOL_NAMES) {
    const contract = LANDLORD_TOOL_CONTRACTS[name];
    assert.equal(contract.name, name);
    assert.ok(contract.description.length > 20, name);
  }
});

test("every stub Tool's result satisfies its contract's output schema", async () => {
  const { tools } = createLandlordStubTools();
  for (const stub of tools) {
    const contract = LANDLORD_TOOL_CONTRACTS[stub.name];
    const result = await stub.invoke(contract.schema.parse(SAMPLE_ARGS[stub.name]));
    assert.doesNotThrow(() => contract.output.parse(result), stub.name);
  }
});

test("removing an applicant from the Shortlist is a valid stub call too", async () => {
  const { tools } = createLandlordStubTools();
  const shortlist = tools.find((candidate) => candidate.name === "update_shortlist");
  const result = await shortlist.invoke({ applicantId: "A-002", status: "remove" });
  assert.doesNotThrow(() => LANDLORD_TOOL_CONTRACTS.update_shortlist.output.parse(result));
});

test("stub data names applicants by id only, never by name or protected characteristic", async () => {
  const { tools } = createLandlordStubTools();
  for (const stub of tools) {
    const text = JSON.stringify(await stub.invoke(SAMPLE_ARGS[stub.name]));
    assert.doesNotMatch(text, /"(name|contact|email|phone|nationality|religion|dateOfBirth|gender|photo|familyPlans)"/, stub.name);
  }
});

test("the Orchestrator refuses to start when a Tool is missing or misnamed", () => {
  const model = new ScriptedChatModel([]);
  const { tools } = createLandlordStubTools();

  const missing = tools.filter((candidate) => candidate.name !== "get_rent_check");
  assert.throws(() => createLandlordOrchestrator({ model, tools: missing }), /missing required tools: get_rent_check/);

  const misnamed = tools.map((candidate) =>
    candidate.name === "get_ranking" ? { ...candidate, name: "getRanking", invoke: candidate.invoke } : candidate,
  );
  assert.throws(() => createLandlordOrchestrator({ model, tools: misnamed }), /missing required tools: get_ranking/);
});

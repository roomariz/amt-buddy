import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

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
  compare_applicants: { applicantIds: ["A-001", "A-004"] },
  update_selection_criteria: { changes: [{ requirement: "schufaCleanOnly", value: true }] },
  adjust_selection_criteria: { changes: [{ criterion: "employment", by: "factor", value: 1.3 }] },
  update_flat_details: { facts: [{ fact: "askingRent", value: 1100 }, { fact: "livingAreaSqm", value: 65 }, { fact: "rooms", value: 2 }] },
  remember_preference: { note: "I'd like someone who stays long-term." },
  update_shortlist: { applicantId: "A-001", status: "to_invite", note: "Stable income" },
  get_rent_check: {},
  set_bonus_points: { by: "factor", value: 1.3 },
};

test("the ten landlord Tools have contracts", () => {
  assert.deepEqual(LANDLORD_TOOL_NAMES.sort(), [
    "adjust_selection_criteria",
    "compare_applicants",
    "get_applicant_profile",
    "get_ranking",
    "get_rent_check",
    "remember_preference",
    "set_bonus_points",
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

// The paths of every optional property in a JSON schema, at any depth ("facts[].value").
function optionalProperties(schema, path = "") {
  if (Array.isArray(schema)) return schema.flatMap((item) => optionalProperties(item, path));
  if (!schema || typeof schema !== "object") return [];
  const found = [];
  const required = new Set(schema.required ?? []);
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      for (const [name, property] of Object.entries(value)) {
        const at = path ? `${path}.${name}` : name;
        if (!required.has(name)) found.push(at);
        found.push(...optionalProperties(property, at));
      }
    } else {
      found.push(...optionalProperties(value, key === "items" ? `${path}[]` : path));
    }
  }
  return found;
}

// A live model (gpt-4.1) filled every optional input with a value (a share of 0 next to its
// factor, building year 0, then an invented 1800): the scripted model cannot reproduce that, so
// the contracts themselves must leave nothing to fill.
test("no landlord Tool input has an optional property, at any depth", () => {
  // The check finds an optional property where there is one, nested in a list too.
  const canary = z.object({ facts: z.array(z.object({ fact: z.string(), year: z.number().optional() })) });
  assert.deepEqual(optionalProperties(z.toJSONSchema(canary, { io: "input" })), ["facts[].year"]);

  for (const name of LANDLORD_TOOL_NAMES) {
    const schema = z.toJSONSchema(LANDLORD_TOOL_CONTRACTS[name].schema, { io: "input" });
    assert.deepEqual(optionalProperties(schema), [], name);
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
  const result = await shortlist.invoke({ applicantId: "A-002", status: "remove", note: null });
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

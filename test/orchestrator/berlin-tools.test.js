import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentStore } from "../../src/document-store.js";
import { parseTenancyDocument } from "../../src/ocr-extraction.js";
import { createBerlinTools } from "../../src/orchestrator/berlin-tools.js";
import { createOrchestrator } from "../../src/orchestrator/index.js";
import { assertToolsMatchContracts, TOOL_CONTRACTS } from "../../src/orchestrator/tool-contracts.js";
import { errorKind } from "../../src/orchestrator/tool-wrapper.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { ScriptedChatModel } from "./helpers/scripted-model.js";

function berlinTools(options) {
  const wfs = createFakeBerlinWfs(options);
  const byName = assertToolsMatchContracts(createBerlinTools({ fetchImpl: wfs.fetchImpl }).tools);
  // Invokes a Tool and checks its result against the contract's output schema.
  async function call(name, args) {
    const result = await byName.get(name).invoke(args);
    TOOL_CONTRACTS[name].output.parse(result);
    return result;
  }
  return { call, byName, requests: wfs.requests };
}

// The error a Tool call throws, as the Orchestrator's Tool wrapper classifies it.
async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { kind: errorKind(error), message: error.message };
  }
  assert.fail("expected the Tool call to throw");
}

test("validate_berlin_address returns the official address with its Wohnlage", async () => {
  const { call, requests } = berlinTools();

  const result = await call("validate_berlin_address", { address: "Berliner Straße 155, 10715 Berlin" });

  assert.equal(result.verified, true);
  assert.deepEqual(
    {
      street: result.address.street,
      houseNumber: result.address.houseNumber,
      postalCode: result.address.postalCode,
      district: result.address.district,
      coordinates: result.address.coordinates,
      residentialLocation: result.address.residentialLocation,
    },
    {
      street: "Berliner Straße",
      houseNumber: "155",
      postalCode: "10715",
      district: "Charlottenburg-Wilmersdorf",
      coordinates: { longitude: 13.33180786, latitude: 52.48705839 },
      residentialLocation: "gut",
    },
  );
  assert.deepEqual(
    requests.map((r) => r.service),
    ["address", "residentialLocation"],
    "no building-age, Mietspiegel or occupancy work",
  );
});

test("validate_berlin_address accepts the address forms a chat passes: abbreviated street, no comma, ASCII 'ss'", async () => {
  const { call } = berlinTools();

  for (const address of [
    "Berliner Str. 155, 10715 Berlin",
    "Berliner Straße 155 10715",
    "Berliner Strasse 155 10715 Berlin",
    "berliner str. 155, 10715",
    "Berliner Straße 155\n10715 Berlin-Wilmersdorf",
    "Berliner Straße 155 10715, Berlin",
    "Berliner Str. 155, Berlin 10715",
  ]) {
    const result = await call("validate_berlin_address", { address });
    assert.equal(result.verified, true, address);
    assert.equal(result.address.street, "Berliner Straße", address);
  }
});

test("a well-formed address the register does not know is not verified, without an error", async () => {
  const { call, requests } = berlinTools();

  const result = await call("validate_berlin_address", { address: "Fantasiestraße 1, 10115 Berlin" });

  assert.deepEqual(result, { verified: false, address: null });
  assert.deepEqual(
    requests.map((r) => r.service),
    ["address"],
  );
});

test("an address without postal code or house number is an input error that asks for it", async () => {
  const { byName, requests } = berlinTools();
  const validate = byName.get("validate_berlin_address");

  for (const address of ["Berliner Straße 155", "Berliner Straße 155, Berlin", "Berliner Straße, 10715 Berlin"]) {
    const { kind, message } = await failure(validate.invoke({ address }));
    assert.equal(kind, "input", address);
    assert.match(message, /street, house number and postal code/, address);
  }
  const outside = await failure(validate.invoke({ address: "Mönckebergstraße 7, 20095 Hamburg" }));
  assert.equal(outside.kind, "input");
  assert.match(outside.message, /Berlin's 10115–14199 range/);
  assert.equal(requests.length, 0, "no service is asked");
});

test("address service failures are upstream errors", async () => {
  for (const status of [{ address: 503 }, { residentialLocation: 500 }]) {
    const { byName } = berlinTools({ status });
    const { kind, message } = await failure(
      byName.get("validate_berlin_address").invoke({ address: "Berliner Straße 155, 10715 Berlin" }),
    );
    assert.equal(kind, "upstream", JSON.stringify(status));
    assert.match(message, /returned 50\d/);
  }

  const offline = createBerlinTools({
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  }).tools.find((t) => t.name === "validate_berlin_address");
  const network = await failure(offline.invoke({ address: "Berliner Straße 155, 10715 Berlin" }));
  assert.equal(network.kind, "upstream");
});

test("lookup_building_age returns the block's predominant construction period", async () => {
  const { call, requests } = berlinTools();

  const result = await call("lookup_building_age", { longitude: 13.45757044, latitude: 52.50968607 });

  assert.equal(result.predominantConstructionPeriod, "1901-1910");
  assert.equal(result.buildingSpecific, false, "a block-level value, not the building's own year");
  assert.deepEqual(
    requests.map((r) => r.service),
    ["buildingAge"],
  );
});

test("lookup_building_age without data for the coordinates reports it as not available, without an error", async () => {
  const { call } = berlinTools();

  const result = await call("lookup_building_age", { longitude: 13.35, latitude: 52.5145 });

  assert.equal(result.predominantConstructionPeriod, null);
  assert.match(result.note, /No official building-age data/);
});

test("building-age service failures are upstream errors", async () => {
  const { byName } = berlinTools({ status: { buildingAge: 502 } });

  const { kind } = await failure(byName.get("lookup_building_age").invoke({ longitude: 13.45757044, latitude: 52.50968607 }));

  assert.equal(kind, "upstream");
});

test("calculate_mietspiegel returns the reference range for the Wohnlage, construction period and living area", async () => {
  const { call, requests } = berlinTools();

  const result = await call("calculate_mietspiegel", {
    residentialLocation: "gut",
    buildingAgeOrYear: "1901-1910",
    livingAreaSqm: 50,
    contractRent: 700,
  });

  // Field C4 (bis 1918, gut, 40–60 m²): 8.40–12.20 €/m², so 420–610 € for 50 m².
  assert.equal(result.status, "calculated");
  assert.equal(result.field, "C4");
  assert.deepEqual(result.monthlyReferenceRent, { lower: 420, median: 490, upper: 610 });
  assert.equal(result.contractRentComparison.status, "above");
  assert.equal(result.contractRentComparison.differenceFromThreshold, 90);
  assert.equal(requests.length, 0, "no Berlin service is asked");
});

test("a construction period with no Mietspiegel class is a result that says so, not an error", async () => {
  const { call } = berlinTools();

  const result = await call("calculate_mietspiegel", {
    residentialLocation: "gut",
    buildingAgeOrYear: "gemischte Baualtersklasse",
    livingAreaSqm: 50,
  });

  assert.equal(result.status, "missing_building_age");
});

test("invalid Mietspiegel and occupancy arguments are input errors", async () => {
  const { byName } = berlinTools();
  const base = { residentialLocation: "gut", buildingAgeOrYear: 1905, livingAreaSqm: 50 };

  for (const args of [
    { ...base, residentialLocation: "sehr gut" },
    { ...base, livingAreaSqm: -5 },
    { ...base, featureGroups: { bathroom: "positive" } },
  ]) {
    assert.equal((await failure(byName.get("calculate_mietspiegel").invoke(args))).kind, "input", JSON.stringify(args));
  }
  const occupancy = await failure(
    byName.get("assess_occupancy_compliance").invoke({ livingAreaSqm: 50, rooms: 2, occupants: 2, childrenUpToSix: 3 }),
  );
  assert.equal(occupancy.kind, "input", "more children than occupants");
});

test("assess_occupancy_compliance checks the living area per person under § 7 WoAufG Bln", async () => {
  const { call } = berlinTools();

  const result = await call("assess_occupancy_compliance", { livingAreaSqm: 20, rooms: 1, occupants: 2, childrenUpToSix: 1 });

  // One adult (9 m²) and one child up to six (6 m²) need 15 m².
  assert.equal(result.status, "meets_minimum");
  assert.equal(result.requiredAreaSqm, 15);
});

const LEASE_TEXT = [
  "Mietvertrag",
  "Mietobjekt: Wühlischstraße 30, 10245 Berlin",
  "Wohnfläche: 50 m²",
  "Zimmer: 2",
  "Baujahr: 1905",
  "Personen: 2",
  "Nettokaltmiete: 30.000,00 EUR",
].join("\n");

function leaseTools() {
  const documents = createDocumentStore();
  const byName = assertToolsMatchContracts(createBerlinTools({ documents }).tools);
  const upload = (text) => documents.put({ extraction: parseTenancyDocument(text), text }).documentId;
  return { byName, upload };
}

test("extract_lease_data reads an uploaded lease's OCR result, passing its confidence values through", async () => {
  const { byName, upload } = leaseTools();
  const documentId = upload(LEASE_TEXT);

  const lease = await byName.get("extract_lease_data").invoke({ documentId });

  assert.doesNotThrow(() => TOOL_CONTRACTS.extract_lease_data.output.parse(lease));
  assert.deepEqual(lease.fields, {
    address: { value: "Wühlischstraße 30, 10245 Berlin", confidence: 0.95 },
    livingAreaSqm: { value: 50, confidence: 0.95 },
    rooms: { value: 2, confidence: 0.9 },
    buildingYear: { value: 1905, confidence: 0.95 },
    occupants: { value: 2, confidence: 0.85 },
    // An implausible rent is read with low confidence, so it becomes an Unconfirmed fact.
    contractRent: { value: 30000, confidence: 0.5 },
  });
});

test("extract_lease_data leaves out what the lease does not state, and keeps a street without postal code", async () => {
  const { byName, upload } = leaseTools();
  const documentId = upload("Mietvertrag\nMietobjekt: Wühlischstraße 30\nNettokaltmiete: 700 EUR");

  const lease = await byName.get("extract_lease_data").invoke({ documentId });

  assert.deepEqual(lease.fields, {
    address: { value: "Wühlischstraße 30", confidence: 0.6 },
    contractRent: { value: 700, confidence: 0.95 },
  });
});

test("an unknown or expired documentId is an input error that asks for the upload again", async () => {
  const { byName } = leaseTools();

  const { kind, message } = await failure(byName.get("extract_lease_data").invoke({ documentId: "doc-unknown" }));

  assert.equal(kind, "input");
  assert.match(message, /upload/i);
});

// Answers from the recorded responses after `delayMs`, or fails when the request's signal aborts.
function slowBerlinWfs(delayMs) {
  const wfs = createFakeBerlinWfs();
  return async (url, init = {}) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      });
    });
    return wfs.fetchImpl(url, init);
  };
}

test("all Berlin requests of one Tool call share the per-attempt time budget, then are aborted as upstream errors", async () => {
  // Each request alone fits the 60 ms budget; the address lookup plus the Wohnlage lookup do not.
  const { tools } = createBerlinTools({ fetchImpl: slowBerlinWfs(40), timeoutMs: 60 });
  const validate = tools.find((t) => t.name === "validate_berlin_address");
  const lookup = tools.find((t) => t.name === "lookup_building_age");

  const started = Date.now();
  const { kind } = await failure(validate.invoke({ address: "Wühlischstraße 30, 10245 Berlin" }));
  assert.equal(kind, "upstream");
  assert.ok(Date.now() - started < 200, "aborted when the budget ran out");

  const area = await lookup.invoke({ longitude: 13.45757044, latitude: 52.50968607 });
  assert.equal(area.predominantConstructionPeriod, "1901-1910", "every call gets a fresh budget");
});

function berlinOrchestrator({ router, supervisor, subAgent }) {
  const wfs = createFakeBerlinWfs();
  const models = {
    router: new ScriptedChatModel(router),
    supervisor: new ScriptedChatModel(supervisor),
    subAgent: new ScriptedChatModel(subAgent),
  };
  const logs = [];
  const orchestrator = createOrchestrator({
    models,
    tools: createBerlinTools({ fetchImpl: wfs.fetchImpl }).tools,
    log: (entry) => logs.push(entry),
  });
  async function send(input) {
    const events = [];
    for await (const event of orchestrator.send(input)) events.push(event);
    return events;
  }
  return { orchestrator, send, models, logs, requests: wfs.requests };
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const stepsOf = (events) => events.filter((e) => e.type === "agent_step").map((e) => `${e.agent}:${e.status}`);

test("one Orchestrator turn chains address, building age and Mietspiegel on the real Tools", async () => {
  const { orchestrator, send, models, logs, requests } = berlinOrchestrator({
    router: [{ intents: ["address", "mietspiegel"], language: "de" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Wühlischstr. 30 10245" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 700 },
                { fact: "rentedBefore", value: true },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
        ],
      },
      { toolCalls: [{ name: "ask_compliance_agent", args: { request: "Check the rent", checks: ["mietspiegel"] } }] },
      "Wühlischstraße 30, 10245 Berlin liegt in guter Wohnlage, der Block wurde überwiegend 1901-1910 gebaut. Ihre Nettokaltmiete von 700 € liegt 90,00 € über der Obergrenze des Mietspiegels 2026 (8,40–12,20 €/m², also 420–610 € für 50 m²).",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Wühlischstr. 30 10245" } }] },
      { toolCalls: [{ name: "lookup_building_age", args: {} }] },
      "Address verified, Wohnlage gut, block built 1901-1910.",
      {
        toolCalls: [
          {
            name: "calculate_mietspiegel",
            args: { residentialLocation: "gut", buildingAgeOrYear: "1901-1910", livingAreaSqm: 50, contractRent: 700 },
          },
        ],
      },
      "Mietspiegel calculated; contract rent above the upper threshold.",
    ],
  });

  const events = await send({ threadId: "berlin-1", message: "Wühlischstr. 30 10245, 50 m², 700 € kalt. Zahle ich zu viel?" });

  assert.equal(events.at(-1).type, "done", JSON.stringify(events.at(-1)));
  assert.deepEqual(
    logs.map((l) => [l.tool, l.outcome]),
    [
      ["validate_berlin_address", "ok"],
      ["lookup_building_age", "ok"],
      ["calculate_mietspiegel", "ok"],
    ],
  );
  assert.deepEqual(
    requests.map((r) => r.service),
    ["address", "residentialLocation", "buildingAge"],
  );
  const tenancy = await orchestrator.getTenancy("berlin-1");
  assert.deepEqual(tenancy.address, { value: "Wühlischstraße 30, 10245 Berlin", source: "official", statedBy: "user" });
  assert.deepEqual(tenancy.coordinates.value, { longitude: 13.45757044, latitude: 52.50968607 });
  assert.equal(tenancy.residentialLocation.value, "gut");
  assert.equal(tenancy.buildingYear.value, "1901-1910");
  const report = JSON.parse(models.supervisor.calls[2].at(-1).content);
  assert.equal(report.results[0].result.field, "C4");
  assert.equal(report.results[0].result.contractRentComparison.differenceFromThreshold, 90);
  const answer = answerOf(events);
  assert.match(answer, /90,00 € über der Obergrenze/);
  assert.match(answer, /keine Rechtsberatung/);
  assert.equal(models.supervisor.remaining, 0, "no grounding rewrite was needed");
});

test("an address without postal code ends the turn with a question, not an outage", async () => {
  const { send, models, requests } = berlinOrchestrator({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          { name: "record_tenancy_facts", args: { facts: [{ fact: "address", value: "Berliner Straße 155" }] } },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
        ],
      },
      "What is the postal code of Berliner Straße 155?",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Straße 155" } }] },
      "The address is missing its postal code.",
    ],
  });

  const events = await send({ threadId: "berlin-2", message: "Is Berliner Straße 155 a real address?" });

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:finished"]);
  assert.equal(requests.length, 0);
  const report = JSON.parse(models.supervisor.calls[1].at(-1).content);
  assert.equal(report.results[0].error.kind, "input");
  assert.match(report.results[0].error.message, /postal code/);
  assert.match(answerOf(events), /postal code/);
  assert.equal(events.at(-1).type, "done");
});

test("a block of mixed construction periods leaves the building year open, so the Mietspiegel check asks for it", async () => {
  const { orchestrator, send, models, logs } = berlinOrchestrator({
    router: [{ intents: ["address", "mietspiegel"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155, 10715 Berlin" },
                { fact: "livingAreaSqm", value: 50 },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
        ],
      },
      { toolCalls: [{ name: "ask_compliance_agent", args: { request: "Check the rent", checks: ["mietspiegel"] } }] },
      "The block around Berliner Straße 155 has buildings from different periods. In which year was your building built?",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Str. 155, 10715 Berlin" } }] },
      { toolCalls: [{ name: "lookup_building_age", args: {} }] },
      "Address verified, Wohnlage gut; the block has mixed construction periods.",
    ],
  });

  const events = await send({ threadId: "berlin-3", message: "Berliner Str. 155, 10715 Berlin, 50 m². Mietspiegel?" });

  const tenancy = await orchestrator.getTenancy("berlin-3");
  assert.equal(tenancy.residentialLocation.value, "gut");
  assert.equal(tenancy.buildingYear, undefined, "'gemischte Baualtersklasse' is not a building year");
  assert.deepEqual(stepsOf(events), [
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:needs_facts",
  ]);
  const report = JSON.parse(models.supervisor.calls[2].at(-1).content);
  assert.deepEqual(report.missing, ["buildingYear"]);
  assert.equal(logs.length, 2, "no Mietspiegel Tool call");
  assert.match(answerOf(events), /In which year/);
});

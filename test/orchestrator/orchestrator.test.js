import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../../src/orchestrator/index.js";
import { createStubTools } from "../../src/orchestrator/stub-tools.js";
import { ScriptedChatModel } from "./helpers/scripted-model.js";

function setup({ router = [], supervisor = [], subAgent = [], toolOverrides } = {}) {
  const models = {
    router: new ScriptedChatModel(router),
    supervisor: new ScriptedChatModel(supervisor),
    subAgent: new ScriptedChatModel(subAgent),
  };
  const { tools, calls } = createStubTools(toolOverrides);
  const logs = [];
  const orchestrator = createOrchestrator({ models, tools, log: (entry) => logs.push(entry), toolTimeoutMs: 50 });
  return { orchestrator, models, calls, logs };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const stepsOf = (events) => events.filter((e) => e.type === "agent_step").map((e) => `${e.agent}:${e.status}`);

const recordAddressAndVerify = (address) => ({
  toolCalls: [
    { name: "record_tenancy_facts", args: { facts: [{ fact: "address", value: address }] } },
    { name: "ask_official_data_agent", args: { request: "Verify the address" } },
  ],
});

const OFFICIAL_DATA_SCRIPT = [
  { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Str. 155" } }] },
  { toolCalls: [{ name: "lookup_building_age", args: { longitude: 13.3295, latitude: 52.4872 } }] },
  "Address verified, Wohnlage gut, block built 1921 - 1930.",
];

test("an out-of-scope request gets a fixed reply without reaching the Supervisor", async () => {
  const { orchestrator, models } = setup({ router: [{ intents: ["out_of_scope"], language: "en" }] });

  const events = await collect(orchestrator.send({ threadId: "t1", message: "Write me a poem about cats" }));

  assert.deepEqual(
    events.map((e) => e.type),
    ["intent", "token", "done"],
  );
  assert.deepEqual(events[0], { type: "intent", intents: ["out_of_scope"] });
  assert.match(answerOf(events), /I can only help with Berlin housing questions/);
  assert.equal(models.supervisor.calls.length, 0);
});

test("the out-of-scope reply is in the user's language", async () => {
  const { orchestrator } = setup({
    router: [
      { intents: ["out_of_scope"], language: "de" },
      { intents: ["out_of_scope"], language: "fr" },
    ],
  });

  const german = answerOf(await collect(orchestrator.send({ threadId: "t1-de", message: "Schreib mir ein Gedicht" })));
  const french = answerOf(await collect(orchestrator.send({ threadId: "t1-fr", message: "Écris-moi un poème" })));

  assert.match(german, /Ich kann nur bei Fragen rund ums Wohnen in Berlin helfen/);
  assert.match(french, /Je ne peux vous aider que pour des questions de logement à Berlin/);
});

test("a message mixing a housing Intent with out_of_scope is handled as in scope", async () => {
  const { orchestrator, models } = setup({
    router: [{ intents: ["mietspiegel", "out_of_scope"], language: "en" }],
    supervisor: ["Tell me your address and living area and I'll check the Mietspiegel."],
  });

  const events = await collect(orchestrator.send({ threadId: "t2", message: "Rent check, and tell me a joke" }));

  assert.deepEqual(events[0], { type: "intent", intents: ["mietspiegel"] });
  assert.match(answerOf(events), /Tell me your address/);
  assert.equal(events.at(-1).type, "done");
  assert.equal(models.supervisor.calls.length, 1);
});

test("a general question gets the disclaimer on the first answer of a thread only", async () => {
  const { orchestrator } = setup({
    router: [
      { intents: ["general"], language: "en" },
      { intents: ["general"], language: "en" },
      { intents: ["general"], language: "en" },
    ],
    supervisor: [
      "Kaltmiete (cold rent) excludes heating and service charges; Warmmiete (warm rent) includes them.",
      "An Anmeldung (residence registration) is required when you move.",
      "A Mieterverein (tenants' association) advises its members.",
    ],
  });

  const first = await collect(orchestrator.send({ threadId: "t3", message: "Kaltmiete vs Warmmiete?" }));
  const second = await collect(orchestrator.send({ threadId: "t3", message: "What is an Anmeldung?" }));
  const otherThread = await collect(orchestrator.send({ threadId: "t3-other", message: "What is a Mieterverein?" }));

  assert.deepEqual(
    first.map((e) => e.type),
    ["intent", "token", "done"],
  );
  assert.match(answerOf(first), /^Kaltmiete \(cold rent\)/);
  assert.match(answerOf(first), /not legal advice/);
  assert.deepEqual(second[0], { type: "intent", intents: ["general"] }, "every classified turn reports its Intents");
  assert.match(answerOf(second), /Anmeldung/);
  assert.doesNotMatch(answerOf(second), /not legal advice/);
  assert.match(answerOf(otherThread), /not legal advice/, "each thread has its own conversation state");
});

test("the conversation persists per thread: the Supervisor sees earlier messages", async () => {
  const { orchestrator, models } = setup({
    router: [
      { intents: ["general"], language: "en" },
      { intents: ["general"], language: "en" },
    ],
    supervisor: ["Kaltmiete (cold rent) excludes heating.", "Warmmiete (warm rent) includes heating."],
  });

  await collect(orchestrator.send({ threadId: "t4", message: "What is Kaltmiete?" }));
  await collect(orchestrator.send({ threadId: "t4", message: "And the other one?" }));

  const secondInput = models.supervisor.calls[1].map((m) => m.content).join("\n");
  assert.match(secondInput, /What is Kaltmiete\?/);
  assert.match(secondInput, /excludes heating/);
});

test("verifying an address stores the Canonical address and its official facts in the Tenancy", async () => {
  const { orchestrator, models, calls, logs } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      recordAddressAndVerify("Berliner Str. 155"),
      "Yes: the official form is Berliner Straße 155, 10715 Berlin (Wohnlage gut, built 1921 - 1930).",
    ],
    subAgent: OFFICIAL_DATA_SCRIPT,
  });

  const events = await collect(orchestrator.send({ threadId: "t8", message: "Is Berliner Str. 155 a real address?" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:finished"]);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address", "lookup_building_age"],
  );
  const expected = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    coordinates: { value: { longitude: 13.3295, latitude: 52.4872 }, source: "official" },
    residentialLocation: { value: "gut", source: "official" },
    buildingYear: { value: "1921 - 1930", source: "official" },
  };
  assert.deepEqual(await orchestrator.getTenancy("t8"), expected);
  const tenancyEvents = events.filter((e) => e.type === "tenancy");
  assert.ok(tenancyEvents.length > 0, "the UI sees the Tenancy change");
  assert.deepEqual(tenancyEvents.at(-1).tenancy, expected);
  assert.ok(
    events.indexOf(tenancyEvents.at(-1)) < events.findIndex((e) => e.type === "token"),
    "the Tenancy snapshot arrives before the answer",
  );
  assert.match(answerOf(events), /Berliner Straße 155/);
  assert.equal(events.at(-1).type, "done");
  assert.deepEqual(
    logs.map((l) => [l.tool, l.outcome]),
    [
      ["validate_berlin_address", "ok"],
      ["lookup_building_age", "ok"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(logs), /Berliner/, "the audit log holds no argument values");
  const supervisorInput = models.supervisor.calls[1].map((m) => m.content).join("\n");
  assert.match(supervisorInput, /Berliner Straße 155, 10715 Berlin/, "the Supervisor sees the Official Data result");
});

test("asking for official data with no address known reports needs_facts and calls no Tool", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      { toolCalls: [{ name: "ask_official_data_agent", args: { request: "Look up the Wohnlage" } }] },
      "Which address should I check?",
    ],
  });

  const events = await collect(orchestrator.send({ threadId: "t9", message: "What's the Wohnlage of my flat?" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:needs_facts"]);
  assert.equal(calls.length, 0);
  assert.equal(models.subAgent.calls.length, 0, "the Sub-agent does not run");
  assert.equal(events.some((e) => e.type === "tenancy"), false);
  const report = models.supervisor.calls[1].at(-1).content;
  assert.deepEqual(JSON.parse(report), { status: "needs_facts", missing: ["address"], unconfirmed: [] });
  assert.match(answerOf(events), /Which address/);
});

test("an unverified address adds no official facts", async () => {
  const { orchestrator, calls } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      recordAddressAndVerify("Fantasiestraße 1"),
      "I couldn't find Fantasiestraße 1 in the official Berlin register. Could you check the spelling?",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Fantasiestraße 1" } }] },
      "Address not found.",
    ],
    toolOverrides: { validate_berlin_address: () => ({ verified: false, address: { street: "Fantasiestraße", houseNumber: "1", postalCode: "10000", district: null, coordinates: null, residentialLocation: null } }) },
  });

  const events = await collect(orchestrator.send({ threadId: "t10", message: "Is Fantasiestraße 1 a real address?" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:finished"]);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address"],
  );
  assert.deepEqual(await orchestrator.getTenancy("t10"), { address: { value: "Fantasiestraße 1", source: "user" } });
});

test("an upstream failure after one retry is reported as failed and adds no official facts", async () => {
  const { orchestrator, calls, logs } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      recordAddressAndVerify("Berliner Str. 155"),
      "The official Berlin address register is not responding right now. Please try again later.",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Str. 155" } }] },
      "The address service returned an upstream error.",
    ],
    toolOverrides: {
      validate_berlin_address: () => {
        throw new Error("Berlin address service returned 503");
      },
    },
  });

  const events = await collect(orchestrator.send({ threadId: "t11", message: "Check Berliner Str. 155" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:failed"]);
  assert.equal(calls.length, 2, "one retry");
  assert.deepEqual(
    logs.map((l) => [l.tool, l.attempts, l.outcome, l.errorKind]),
    [["validate_berlin_address", 2, "error", "upstream"]],
  );
  assert.deepEqual(await orchestrator.getTenancy("t11"), { address: { value: "Berliner Str. 155", source: "user" } });
  assert.match(answerOf(events), /not responding/);
  assert.equal(events.at(-1).type, "done");
});

test("Official Data Tools receive the Tenancy's address and verified coordinates, whatever the model passed or left out", async () => {
  const { orchestrator, calls } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [recordAddressAndVerify("Berliner Str. 155"), "Verified."],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: {} }] },
      { toolCalls: [{ name: "lookup_building_age", args: { longitude: 1, latitude: 2 } }] },
      "Done.",
    ],
  });

  await collect(orchestrator.send({ threadId: "t12", message: "Check Berliner Str. 155" }));

  assert.deepEqual(calls[0].args, { address: "Berliner Str. 155" });
  assert.deepEqual(calls[1].args, { longitude: 13.3295, latitude: 52.4872 });
});

test("no building age is looked up for an address that was not verified", async () => {
  const { orchestrator, calls, logs } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [recordAddressAndVerify("Fantasiestraße 1"), "I couldn't find that address."],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Fantasiestraße 1" } }] },
      { toolCalls: [{ name: "lookup_building_age", args: { longitude: 13.3, latitude: 52.4 } }] },
      "Address not found.",
    ],
    toolOverrides: { validate_berlin_address: () => ({ verified: false, address: null }) },
  });

  await collect(orchestrator.send({ threadId: "t13", message: "Is Fantasiestraße 1 a real address?" }));

  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address"],
  );
  assert.deepEqual(
    logs.map((l) => [l.tool, l.outcome, l.errorKind]),
    [
      ["validate_berlin_address", "ok", undefined],
      ["lookup_building_age", "error", "input"],
    ],
  );
  assert.deepEqual(await orchestrator.getTenancy("t13"), { address: { value: "Fantasiestraße 1", source: "user" } });
});

test("an address the register rejects as malformed is an input problem, not an outage", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [recordAddressAndVerify("Berliner Str."), "Which house number?"],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Str." } }] },
      "The address is missing a house number.",
    ],
    toolOverrides: {
      validate_berlin_address: () => {
        throw Object.assign(new Error("house number missing"), { kind: "input" });
      },
    },
  });

  const events = await collect(orchestrator.send({ threadId: "t14", message: "Check Berliner Str." }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:finished"]);
  assert.equal(calls.length, 1, "no retry");
  const report = JSON.parse(models.supervisor.calls[1].at(-1).content);
  assert.deepEqual(report.results, [
    { tool: "validate_berlin_address", error: { kind: "input", message: "house number missing" } },
  ]);
});

test("a Sub-agent that crashes reports failed before the turn ends with an error", async () => {
  const { orchestrator } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [recordAddressAndVerify("Berliner Str. 155")],
    subAgent: [],
  });

  const events = await collect(orchestrator.send({ threadId: "t15", message: "Check Berliner Str. 155" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:failed"]);
  assert.deepEqual(events.at(-1), { type: "error", message: "ScriptedChatModel ran out of scripted responses" });
});

const mietspiegelCall = (contractRent) => ({
  toolCalls: [
    {
      name: "calculate_mietspiegel",
      args: { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50, contractRent },
    },
  ],
});

test("one turn chains Official Data and Compliance into a Mietspiegel verdict on the Tenancy's values", async () => {
  const { orchestrator, models, calls, logs } = setup({
    router: [{ intents: ["address", "mietspiegel"], language: "de" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 780 },
                { fact: "rentedBefore", value: true },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
        ],
      },
      { toolCalls: [{ name: "ask_compliance_agent", args: { request: "Check the rent", checks: ["mietspiegel"] } }] },
      // German number formats, a rounded value (15.6 → 16) and legal citations, all grounded.
      "Ihre Nettokaltmiete von 780 € liegt 225,00 € über der Obergrenze des Mietspiegels 2026 (8,20–11,10 €/m², also 410–555 € für 50 m², §§ 558c, 558d BGB). Das sind rund 16 €/m²; vgl. §§ 556d, 556g Abs. 1 BGB und § 5 Abs. 2 WiStG.",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      // The Sub-agent model drifts from the Tenancy (800 instead of 780); pinning corrects it.
      mietspiegelCall(800),
      "Mietspiegel calculated; contract rent above the upper threshold.",
    ],
  });

  const events = await collect(
    orchestrator.send({ threadId: "t20", message: "Berliner Str. 155, 50 m², 780 € kalt. Zahle ich zu viel?" }),
  );

  assert.deepEqual(stepsOf(events), [
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:started",
    "ComplianceAgent:finished",
  ]);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address", "lookup_building_age", "calculate_mietspiegel"],
  );
  assert.deepEqual(calls[2].args, {
    residentialLocation: "gut",
    buildingAgeOrYear: "1921 - 1930",
    livingAreaSqm: 50,
    contractRent: 780,
    rentedBefore: true,
  });
  const complianceTask = models.subAgent.calls[3].map((m) => m.content).join("\n");
  assert.match(complianceTask, /Checks: mietspiegel/, "the Compliance Sub-agent is told which checks to run");
  assert.match(complianceTask, /"residentialLocation":"gut"/, "it sees the Wohnlage Official Data just produced");
  const report = JSON.parse(models.supervisor.calls[2].at(-1).content);
  assert.equal(report.results[0].result.contractRentComparison.differenceFromThreshold, 225);
  const answer = answerOf(events);
  assert.match(answer, /225,00 € über der Obergrenze/);
  assert.match(answer, /Das sind rund 16 €\/m²; vgl\. §§ 556d, 556g Abs\. 1 BGB und § 5 Abs\. 2 WiStG\./);
  assert.doesNotMatch(answer, /weggelassen/);
  assert.equal(models.supervisor.calls.length, 3, "no grounding rewrite was needed");
  assert.match(answer, /keine Rechtsberatung/);
  assert.equal(logs.length, 3);
  assert.equal(events.at(-1).type, "done");
});

test("an occupancy check without occupants ends the turn with a question, and the next turn completes it", async () => {
  const { orchestrator, models, calls } = setup({
    router: [
      { intents: ["occupancy"], language: "en" },
      { intents: ["occupancy"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: { facts: [{ fact: "livingAreaSqm", value: 50 }, { fact: "rooms", value: 2 }] },
          },
          { name: "ask_compliance_agent", args: { request: "Check occupancy", checks: ["occupancy"] } },
        ],
      },
      "How many people live in the flat, and how many of them are children up to six?",
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: { facts: [{ fact: "occupants", value: 4 }, { fact: "childrenUpToSix", value: 1 }] },
          },
          { name: "ask_compliance_agent", args: { request: "Check occupancy", checks: ["occupancy"] } },
        ],
      },
      "For 4 people (1 child up to six) the flat needs 33 m²; your 50 m² meets § 7 WoAufG Bln.",
    ],
    subAgent: [
      {
        toolCalls: [
          { name: "assess_occupancy_compliance", args: { livingAreaSqm: 50, rooms: 2, occupants: 4, childrenUpToSix: 1 } },
        ],
      },
      "Meets minimum; required 33 m².",
    ],
  });

  const first = await collect(orchestrator.send({ threadId: "t21", message: "Is my 50 m² 2-room flat overcrowded?" }));

  assert.deepEqual(stepsOf(first), ["ComplianceAgent:needs_facts"]);
  assert.equal(calls.length, 0);
  assert.equal(models.subAgent.calls.length, 0, "the Sub-agent does not run");
  assert.deepEqual(JSON.parse(models.supervisor.calls[1].at(-1).content), {
    status: "needs_facts",
    checks: ["occupancy"],
    missing: ["occupants", "childrenUpToSix"],
    unconfirmed: [],
  });
  assert.match(answerOf(first), /How many people/);

  const second = await collect(orchestrator.send({ threadId: "t21", message: "4 people, one is 3 years old" }));

  const routerInput = models.router.calls[1].map((m) => m.content).join("\n");
  assert.match(routerInput, /How many people live in the flat/, "the router sees the question being answered");
  assert.ok(
    models.router.calls[1].every((m) => m.getType() !== "tool" && !m.tool_calls?.length),
    "the router sees the conversation, not the Supervisor's tool traffic",
  );
  assert.deepEqual(second[0], { type: "intent", intents: ["occupancy"] });
  assert.deepEqual(stepsOf(second), ["ComplianceAgent:started", "ComplianceAgent:finished"]);
  assert.deepEqual(calls, [
    { name: "assess_occupancy_compliance", args: { livingAreaSqm: 50, rooms: 2, occupants: 4, childrenUpToSix: 1 } },
  ]);
  assert.match(answerOf(second), /needs 33 m²/);
  assert.match(answerOf(second), /not legal advice/, "the verdict carries the disclaimer although the first answer had it");
});

test("a Mietspiegel check without Wohnlage and building year reports needs_facts and calls no Tool", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["mietspiegel"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          { name: "record_tenancy_facts", args: { facts: [{ fact: "livingAreaSqm", value: 50 }] } },
          { name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } },
        ],
      },
      "What is the address of the flat?",
    ],
  });

  const events = await collect(orchestrator.send({ threadId: "t22", message: "50 m², am I paying too much?" }));

  assert.deepEqual(stepsOf(events), ["ComplianceAgent:needs_facts"]);
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(models.supervisor.calls[1].at(-1).content).missing, [
    "residentialLocation",
    "buildingYear",
  ]);
});

test("a Compliance request with one check short of facts still runs the other check", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["mietspiegel", "occupancy"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 780 },
                { fact: "rentedBefore", value: true },
                { fact: "rooms", value: 2 },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
          { name: "ask_compliance_agent", args: { request: "Both checks", checks: ["mietspiegel", "occupancy"] } },
        ],
      },
      "Your rent of 780 € is above the range. How many people live in the flat, and how many are children up to six?",
    ],
    subAgent: [...OFFICIAL_DATA_SCRIPT, mietspiegelCall(780), "Calculated."],
  });

  const events = await collect(
    orchestrator.send({ threadId: "t26", message: "Berliner Str. 155, 50 m², 2 rooms, 780 € cold. Too expensive? Overcrowded?" }),
  );

  assert.deepEqual(stepsOf(events), [
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:needs_facts",
    "ComplianceAgent:started",
    "ComplianceAgent:finished",
  ]);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address", "lookup_building_age", "calculate_mietspiegel"],
  );
  assert.match(models.subAgent.calls[3].map((m) => m.content).join("\n"), /Checks: mietspiegel\n/);
  const report = JSON.parse(models.supervisor.calls[1].at(-1).content);
  assert.equal(report.status, "done");
  assert.deepEqual(report.needsFacts, { checks: ["occupancy"], missing: ["occupants", "childrenUpToSix"], unconfirmed: [] });
  assert.equal(report.results[0].tool, "calculate_mietspiegel");
});

test("a correction replaces the fact and the check re-runs with the new value", async () => {
  const { orchestrator, calls } = setup({
    router: [
      { intents: ["mietspiegel"], language: "en" },
      { intents: ["mietspiegel"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 780 },
                { fact: "rentedBefore", value: true },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
          { name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } },
        ],
      },
      "Your rent of 780 € is above the range.",
      {
        toolCalls: [
          { name: "record_tenancy_facts", args: { facts: [{ fact: "contractRent", value: "720" }] } },
          { name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } },
        ],
      },
      "With 720 € your rent is still above the range.",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      mietspiegelCall(780),
      "Calculated.",
      // The model repeats the old value; the re-run must still use the correction.
      mietspiegelCall(780),
      "Calculated.",
    ],
  });

  await collect(orchestrator.send({ threadId: "t23", message: "Berliner Str. 155, 50 m², 780 € cold" }));
  const second = await collect(orchestrator.send({ threadId: "t23", message: "Actually the cold rent is 720, not 780" }));

  assert.deepEqual((await orchestrator.getTenancy("t23")).contractRent, { value: 720, source: "user" });
  const tenancyEvents = second.filter((e) => e.type === "tenancy");
  assert.deepEqual(tenancyEvents.at(-1).tenancy.contractRent, { value: 720, source: "user" });
  assert.deepEqual(stepsOf(second), ["ComplianceAgent:started", "ComplianceAgent:finished"]);
  assert.deepEqual(
    calls.filter((c) => c.name === "calculate_mietspiegel").map((c) => c.args.contractRent),
    [780, 720],
  );
  assert.match(answerOf(second), /With 720 €/);
  assert.match(answerOf(second), /not legal advice/, "every Compliance verdict carries the disclaimer");
});

test("a Compliance Tool for a check that was not requested does not run, even with its facts known", async () => {
  const { orchestrator, calls, logs } = setup({
    router: [{ intents: ["occupancy"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 780 },
                { fact: "rooms", value: 2 },
                { fact: "occupants", value: 2 },
                { fact: "childrenUpToSix", value: 0 },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
          { name: "ask_compliance_agent", args: { request: "Check occupancy", checks: ["occupancy"] } },
        ],
      },
      "Your flat meets § 7 WoAufG Bln.",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      mietspiegelCall(780),
      { toolCalls: [{ name: "assess_occupancy_compliance", args: {} }] },
      "Meets minimum.",
    ],
  });

  await collect(orchestrator.send({ threadId: "t24", message: "Berliner Str. 155: 2 adults, 50 m², 2 rooms. Overcrowded?" }));

  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address", "lookup_building_age", "assess_occupancy_compliance"],
  );
  assert.deepEqual(calls[2].args, { livingAreaSqm: 50, rooms: 2, occupants: 2, childrenUpToSix: 0 });
  assert.deepEqual(
    logs.slice(2).map((l) => [l.tool, l.outcome, l.errorKind]),
    [
      ["calculate_mietspiegel", "error", "input"],
      ["assess_occupancy_compliance", "ok", undefined],
    ],
  );
});

test("a Tool argument with no Tenancy fact behind it is dropped, not taken from the model", async () => {
  const { orchestrator, calls } = setup({
    router: [{ intents: ["mietspiegel"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: { facts: [{ fact: "address", value: "Berliner Str. 155" }, { fact: "livingAreaSqm", value: 50 }] },
          },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
          { name: "ask_compliance_agent", args: { request: "Reference rent", checks: ["mietspiegel"] } },
        ],
      },
      "The reference rent for your flat is 410–555 €.",
    ],
    subAgent: [...OFFICIAL_DATA_SCRIPT, mietspiegelCall(999), "Calculated."],
  });

  const events = await collect(
    orchestrator.send({ threadId: "t25", message: "Berliner Str. 155, 50 m². What is the reference rent?" }),
  );

  assert.equal(stepsOf(events).includes("ComplianceAgent:needs_facts"), false, "without a contract rent nothing new is asked");
  assert.deepEqual(calls.at(-1), {
    name: "calculate_mietspiegel",
    args: { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50 },
  });
});

const LEASE_SCRIPT = [
  // The model passes a wrong documentId; the uploaded document is pinned instead.
  { toolCalls: [{ name: "extract_lease_data", args: { documentId: "lease.pdf" } }] },
  "Extracted address, contract rent (confidence 0.6), living area and rooms.",
];

const askLeaseAnalysis = { toolCalls: [{ name: "ask_lease_analysis_agent", args: { request: "Read the lease" } }] };
const askOfficialData = { toolCalls: [{ name: "ask_official_data_agent", args: { request: "Verify the address" } }] };
const askMietspiegel = {
  toolCalls: [{ name: "ask_compliance_agent", args: { request: "Check the rent", checks: ["mietspiegel"] } }],
};

test("an uploaded lease fills the Tenancy, and its unconfirmed contract rent blocks the Mietspiegel check", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["document", "mietspiegel"], language: "en" }],
    supervisor: [
      askLeaseAnalysis,
      askOfficialData,
      askMietspiegel,
      "I read a Nettokaltmiete (net cold rent) of 780 € in your lease, but I'm not sure. Is that right? And was the flat rented out before you moved in?",
    ],
    subAgent: [...LEASE_SCRIPT, ...OFFICIAL_DATA_SCRIPT],
  });

  const events = await collect(
    orchestrator.send({ threadId: "t50", message: "Here is my lease, am I overpaying?", documentId: "doc-1" }),
  );

  assert.deepEqual(stepsOf(events), [
    "LeaseAnalysisAgent:started",
    "LeaseAnalysisAgent:finished",
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:needs_facts",
  ]);
  assert.deepEqual(calls[0], { name: "extract_lease_data", args: { documentId: "doc-1" } });
  assert.equal(calls.some((c) => c.name === "calculate_mietspiegel"), false);
  const tenancy = await orchestrator.getTenancy("t50");
  assert.deepEqual(tenancy.contractRent, { value: 780, source: "lease", confidence: 0.6 });
  assert.deepEqual(tenancy.livingAreaSqm, { value: 50, source: "lease", confidence: 0.92 });
  const firstTenancyEvent = events.find((e) => e.type === "tenancy");
  assert.deepEqual(firstTenancyEvent.tenancy.contractRent, { value: 780, source: "lease", confidence: 0.6 });
  const leaseTask = models.subAgent.calls[0].map((m) => m.content).join("\n");
  assert.match(leaseTask, /doc-1/, "the Lease Analysis Sub-agent is told which document to read");
  const supervisorPrompt = models.supervisor.calls[3][0].content;
  assert.match(supervisorPrompt, /contractRent: 780 \(lease, UNCONFIRMED, confidence 0\.6\)/);
  const complianceReport = JSON.parse(models.supervisor.calls[3].at(-1).content);
  assert.deepEqual(complianceReport, {
    status: "needs_facts",
    checks: ["mietspiegel"],
    missing: ["rentedBefore"],
    unconfirmed: ["contractRent"],
  }, "the unconfirmed rent and the missing 'rented before' are reported together");
  assert.match(answerOf(events), /780 € in your lease/);
});

test("confirming the unconfirmed contract rent skips Intent classification and completes the Mietspiegel check", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["document", "mietspiegel"], language: "en" }],
    supervisor: [
      { toolCalls: [recordFacts([{ fact: "rentedBefore", value: "yes" }]), ...askLeaseAnalysis.toolCalls] },
      askOfficialData,
      askMietspiegel,
      "I read a Nettokaltmiete (net cold rent) of 780 € in your lease, but I'm not sure. Is that right?",
      askMietspiegel,
      "Your confirmed rent of 780 € is 225 € above the upper Mietspiegel threshold of 555 €.",
    ],
    subAgent: [
      ...LEASE_SCRIPT,
      ...OFFICIAL_DATA_SCRIPT,
      mietspiegelCall(780),
      "Mietspiegel calculated; contract rent above the upper threshold.",
    ],
  });
  await collect(
    orchestrator.send({ threadId: "t51", message: "Here is my lease, the flat was rented before. Am I overpaying?", documentId: "doc-1" }),
  );

  const events = await collect(orchestrator.send({ threadId: "t51", confirm: { contractRent: 780 } }));

  assert.equal(events.some((e) => e.type === "intent"), false);
  assert.equal(models.router.calls.length, 1, "the router ran for the first turn only");
  assert.deepEqual(events[0].type, "tenancy", "the confirmation is reported to the UI first");
  assert.deepEqual(events[0].tenancy.contractRent, { value: 780, source: "user" });
  assert.deepEqual(stepsOf(events), ["ComplianceAgent:started", "ComplianceAgent:finished"]);
  assert.deepEqual((await orchestrator.getTenancy("t51")).contractRent, { value: 780, source: "user" });
  assert.equal(calls.filter((c) => c.name === "calculate_mietspiegel").at(-1).args.contractRent, 780);
  assert.match(models.supervisor.calls[4][0].content, /contractRent: 780 \(user\)/);
  assert.match(models.supervisor.calls[0][0].content, /Uploaded document: doc-1 \(new this turn\)/);
  assert.match(models.supervisor.calls[4][0].content, /Uploaded document: doc-1 \(uploaded earlier\)/);
  const answer = answerOf(events);
  assert.match(answer, /225 € above the upper Mietspiegel threshold/);
  assert.match(answer, /not legal advice/, "the Compliance verdict carries the disclaimer");
  assert.equal(models.supervisor.remaining, 0, "no grounding rewrite was needed");
  assert.equal(events.at(-1).type, "done");
});

test("a confirmation reports to the Supervisor only the values it could record", async () => {
  const { orchestrator, models } = setup({ supervisor: ["Thanks, I noted 2 rooms. Which rent is right?"] });

  const events = await collect(orchestrator.send({ threadId: "t55", confirm: { contractRent: "abc", rooms: 2 } }));

  assert.deepEqual(await orchestrator.getTenancy("t55"), { rooms: { value: 2, source: "user" } });
  assert.equal(models.supervisor.calls[0].at(-1).content, '[Confirmed Tenancy facts] {"rooms":2}');
  assert.equal(events.at(-1).type, "done");
});

test("a lease uploaded without a message is classified and read", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["document"], language: "en" }],
    supervisor: [askLeaseAnalysis, "I read your lease: 50 m², 2 rooms. Please confirm the contract rent of 780 €."],
    subAgent: LEASE_SCRIPT,
  });

  const events = await collect(orchestrator.send({ threadId: "t52", documentId: "doc-7" }));

  assert.deepEqual(events[0], { type: "intent", intents: ["document"] });
  assert.match(models.router.calls[0].at(-1).content, /uploaded a lease document/);
  assert.deepEqual(stepsOf(events), ["LeaseAnalysisAgent:started", "LeaseAnalysisAgent:finished"]);
  assert.deepEqual(calls, [{ name: "extract_lease_data", args: { documentId: "doc-7" } }]);
  assert.match(answerOf(events), /Please confirm the contract rent of 780 €/);
  assert.equal(events.at(-1).type, "done");
});

test("Lease Analysis without an uploaded document reports needs_facts and calls no Tool", async () => {
  const { orchestrator, models, calls } = setup({
    router: [{ intents: ["document"], language: "en" }],
    supervisor: [askLeaseAnalysis, "Please upload your lease first."],
  });

  const events = await collect(orchestrator.send({ threadId: "t53", message: "Can you check my lease?" }));

  assert.deepEqual(stepsOf(events), ["LeaseAnalysisAgent:needs_facts"]);
  assert.equal(calls.length, 0);
  assert.equal(models.subAgent.calls.length, 0, "the Sub-agent does not run");
  const report = JSON.parse(models.supervisor.calls[1].at(-1).content);
  assert.deepEqual(report, { status: "needs_facts", missing: ["documentId"], unconfirmed: [] });
  assert.match(answerOf(events), /upload your lease/);
});

test("a lease uploaded later never replaces what the tenant stated", async () => {
  const { orchestrator } = setup({
    router: [
      { intents: ["address"], language: "en" },
      { intents: ["document"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "contractRent", value: 720 },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
        ],
      },
      "Verified: Berliner Straße 155, 10715 Berlin.",
      askLeaseAnalysis,
      "Your lease lists 2 rooms; I kept the rent of 720 € you told me.",
    ],
    subAgent: [...OFFICIAL_DATA_SCRIPT, ...LEASE_SCRIPT],
    toolOverrides: {
      extract_lease_data: () => ({
        fields: {
          address: { value: "Hauptstraße 1, 10827 Berlin", confidence: 0.99 },
          contractRent: { value: 780, confidence: 0.99 },
          rooms: { value: 2, confidence: 0.9 },
        },
      }),
    },
  });
  await collect(orchestrator.send({ threadId: "t54", message: "Berliner Str. 155, I pay 720 € cold" }));

  await collect(orchestrator.send({ threadId: "t54", message: "Here is my lease", documentId: "doc-1" }));

  const tenancy = await orchestrator.getTenancy("t54");
  assert.deepEqual(tenancy.contractRent, { value: 720, source: "user" });
  assert.deepEqual(tenancy.address, { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" });
  assert.equal(tenancy.residentialLocation.value, "gut", "the verified address keeps its official facts");
  assert.deepEqual(tenancy.rooms, { value: 2, source: "lease", confidence: 0.9 }, "new lease facts are still added");
});

test("a general answer quoting an invented figure is rewritten once, and only the rewrite reaches the user", async () => {
  const { orchestrator, models } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: [
      "The Kappungsgrenze in Berlin is 15% over 3 years since 01.05.2013 (§ 558 Abs. 3 BGB and 20% elsewhere, Art. 14 GG).",
      "The Kappungsgrenze (cap on rent increases) is set by law, e.g. in § 558 BGB; see the Senatsverwaltung website.",
    ],
  });

  const events = await collect(orchestrator.send({ threadId: "t40", message: "What is the Kappungsgrenze?" }));

  assert.deepEqual(
    events.map((e) => e.type),
    ["intent", "token", "done"],
    "only the checked answer is emitted",
  );
  const answer = answerOf(events);
  assert.match(answer, /^The Kappungsgrenze \(cap on rent increases\) is set by law/);
  assert.doesNotMatch(answer, /15%/);
  assert.equal(models.supervisor.calls.length, 2, "exactly one rewrite");
  assert.doesNotMatch(models.supervisor.calls[0][0].content, /Correction/);
  const retrySystemPrompt = models.supervisor.calls[1][0].content;
  assert.match(retrySystemPrompt, /not backed by any Tool result, Tenancy fact or the user's message: 15, 3, 01\.05\.2013, 20\./);
});

test("a still-ungrounded rewrite has only the offending sentences removed, with a note in the user's language", async () => {
  const { orchestrator, models } = setup({
    router: [{ intents: ["general"], language: "de" }],
    supervisor: [
      "Die Kappungsgrenze beträgt 15 %. Details beim Mieterverein.",
      "Die Kappungsgrenze begrenzt Mieterhöhungen. Sie liegt z. B. bei 15 % in 3 Jahren. Mehr beim Mieterverein.\n\n- Quelle: Senatsverwaltung\n1. Sie gilt nach § 558 Abs. 3 BGB.\n2. Sie beträgt 20 %.",
    ],
  });

  const answer = answerOf(await collect(orchestrator.send({ threadId: "t41", message: "Was ist die Kappungsgrenze?" })));

  assert.equal(models.supervisor.calls.length, 2, "no second rewrite");
  assert.doesNotMatch(answer, /15|Details beim/);
  assert.match(answer, /^Die Kappungsgrenze begrenzt Mieterhöhungen\. Mehr beim Mieterverein\.\n\n- Quelle: Senatsverwaltung/);
  assert.match(answer, /\n1\. Sie gilt nach § 558 Abs\. 3 BGB\.\n\n/, "a legal citation is not a claim");
  assert.doesNotMatch(answer, /20|\n2\./, "a list item with an ungrounded figure goes with its marker");
  assert.match(answer, /Zahlen, die ich nicht mit amtlichen Daten belegen konnte, habe ich weggelassen\./);
  assert.match(answer, /keine Rechtsberatung/);
});

test("a rewrite with no grounded content left is replaced by the fallback question", async () => {
  const { orchestrator } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: ["The cap is 15%.", "It is 20%.\n\n1. Over 3 years."],
  });

  const answer = answerOf(await collect(orchestrator.send({ threadId: "t42", message: "What is the cap?" })));

  assert.match(answer, /^I couldn't verify my answer against official data\. Could you tell me which check/);
  assert.doesNotMatch(answer, /%|years|I left out figures/);
});

test("figures from the Tenancy and from the tenant's own message are grounded, in either number format", async () => {
  const { orchestrator, models } = setup({
    router: [
      { intents: ["general"], language: "en" },
      { intents: ["general"], language: "en" },
    ],
    supervisor: [
      { toolCalls: [{ name: "record_tenancy_facts", args: { facts: [{ fact: "livingAreaSqm", value: "62,5" }] } }] },
      "Noted: 62.5 m² for 1,234.56 € a month.",
      "Your flat has 62,5 m² and costs 1234.56 €.",
      "Your flat has 62,5 m².",
    ],
  });

  const first = answerOf(
    await collect(orchestrator.send({ threadId: "t43", message: "My flat has 62,5 m² and I pay 1.234,56 € warm." })),
  );
  assert.match(first, /^Noted: 62\.5 m² for 1,234\.56 € a month\./);
  assert.equal(models.supervisor.calls.length, 2, "no rewrite");

  const second = answerOf(await collect(orchestrator.send({ threadId: "t43", message: "What do you know about my flat?" })));
  assert.equal(models.supervisor.calls.length, 4, "a figure from an earlier message only is not grounded");
  assert.match(models.supervisor.calls[3][0].content, /message: 1234\.56\./);
  assert.match(second, /^Your flat has 62,5 m²\./, "the Tenancy fact still is");
});

test("send() rejects a call without threadId, and one without message, document or confirmation", async () => {
  const { orchestrator } = setup();
  await assert.rejects(collect(orchestrator.send({ message: "hi" })), /requires a threadId/);
  await assert.rejects(collect(orchestrator.send({ threadId: "t5" })), /requires a message/);
  await assert.rejects(collect(orchestrator.send({ threadId: "t5", message: "   " })), /requires a message/);
});

test("aborting a turn through its signal stops the run with a single error event", async () => {
  const { orchestrator, models } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: ["This answer is never reached."],
  });
  const abort = new AbortController();

  const events = [];
  for await (const event of orchestrator.send({ threadId: "t-abort", message: "Hi", signal: abort.signal })) {
    events.push(event);
    if (event.type === "intent") abort.abort();
  }

  assert.deepEqual(
    events.map((e) => e.type),
    ["intent", "error"],
  );
  assert.equal(models.supervisor.calls.length, 0, "the Supervisor never ran");
});

test("a model error surfaces as a single error event", async () => {
  const { orchestrator } = setup({ router: [] });

  const events = await collect(orchestrator.send({ threadId: "t6", message: "hi" }));

  assert.deepEqual(events, [{ type: "error", message: "ScriptedChatModel ran out of scripted responses" }]);
});

test("a Supervisor that never stops delegating ends the turn with an error event", async () => {
  const delegateForever = { toolCalls: [{ name: "ask_official_data_agent", args: { request: "Verify" } }] };
  const { orchestrator } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: Array.from({ length: 30 }, () => delegateForever),
  });

  const events = await collect(orchestrator.send({ threadId: "t7", message: "hello" }));

  assert.equal(events.filter((e) => e.type === "error" || e.type === "done").length, 1);
  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /Recursion limit/i);
});

test("createOrchestrator refuses a tool set that misses a contract, naming the Tool", () => {
  const { tools } = createStubTools();
  assert.throws(
    () => createOrchestrator({ models: {}, tools: tools.filter((t) => t.name !== "extract_lease_data") }),
    /missing required tools: extract_lease_data/,
  );
});

// Feature group ratings as record_tenancy_facts entries, e.g. { bathroom: "positive" }.
const ratingFacts = (ratings) =>
  Object.entries(ratings).map(([group, value]) => ({ fact: `${group}Rating`, value }));
const recordFacts = (facts) => ({ name: "record_tenancy_facts", args: { facts } });
const FLAT_FACTS = [
  { fact: "address", value: "Berliner Str. 155" },
  { fact: "livingAreaSqm", value: 50 },
  { fact: "contractRent", value: 780 },
  { fact: "rentedBefore", value: true },
];
const mietspiegelArgs = (contractRent) => mietspiegelCall(contractRent).toolCalls[0].args;
// The arguments calculate_mietspiegel receives for FLAT_FACTS: pinned to the Tenancy.
const pinnedMietspiegelArgs = (contractRent) => ({ ...mietspiegelArgs(contractRent), rentedBefore: true });
const lastMietspiegelReport = (models) => JSON.parse(models.supervisor.calls.at(-1).at(-1).content).results[0].result;

test("feature group ratings given over two turns complete the adjusted reference rent", async () => {
  const { orchestrator, models, calls } = setup({
    router: [
      { intents: ["address", "mietspiegel"], language: "en" },
      { intents: ["mietspiegel"], language: "en" },
      { intents: ["mietspiegel"], language: "en" },
    ],
    supervisor: [
      { toolCalls: [recordFacts(FLAT_FACTS), ...askOfficialData.toolCalls, ...askMietspiegel.toolCalls] },
      "The Mietspiegel reference range for your flat is 410–555 €, so your 780 € is 225 € above it. For a more precise estimate, I can ask you five short questions about the bathroom, kitchen, flat, building and surroundings.",
      { toolCalls: [recordFacts(ratingFacts({ bathroom: "positive", kitchen: "positive", apartment: "neutral" }))] },
      "Thanks. And how do the building and its surroundings compare with usual?",
      {
        toolCalls: [
          recordFacts(ratingFacts({ building: "negative", surroundings: "positive" })),
          ...askMietspiegel.toolCalls,
        ],
      },
      "Estimated from the Orientierungshilfe, your adjusted reference rent is 505,50 € (10,11 €/m²). This estimate is not part of the qualified Mietspiegel: the reference range of 410–555 € still applies, and your 780 € is 225 € above it.",
    ],
    subAgent: [...OFFICIAL_DATA_SCRIPT, mietspiegelCall(780), "Calculated.", mietspiegelCall(780), "Calculated."],
  });

  const first = await collect(orchestrator.send({ threadId: "t60", message: "Berliner Str. 155, 50 m², 780 € cold. Too much?" }));
  const second = await collect(
    orchestrator.send({ threadId: "t60", message: "Bathroom and kitchen are better than usual, the flat itself average." }),
  );
  const partial = await orchestrator.getTenancy("t60");
  const third = await collect(orchestrator.send({ threadId: "t60", message: "The building is worse, the area better." }));

  // Without ratings the Mietspiegel check runs as before.
  assert.deepEqual(stepsOf(first), [
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:started",
    "ComplianceAgent:finished",
  ]);
  assert.deepEqual(calls[2].args, pinnedMietspiegelArgs(780));
  assert.match(answerOf(first), /five short questions/);
  // Partial ratings are stored as the user's facts and run nothing.
  assert.deepEqual(stepsOf(second), []);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address", "lookup_building_age", "calculate_mietspiegel", "calculate_mietspiegel"],
    "only the third turn re-runs the check",
  );
  assert.deepEqual(
    [partial.bathroomRating, partial.kitchenRating, partial.apartmentRating, partial.buildingRating],
    [{ value: "positive", source: "user" }, { value: "positive", source: "user" }, { value: "neutral", source: "user" }, undefined],
  );
  // Complete ratings reach calculate_mietspiegel, and its adjusted rent reaches the answer.
  assert.deepEqual(calls.at(-1).args, {
    ...pinnedMietspiegelArgs(780),
    featureGroups: {
      bathroom: "positive",
      kitchen: "positive",
      apartment: "neutral",
      building: "negative",
      surroundings: "positive",
    },
  });
  const result = lastMietspiegelReport(models);
  assert.equal(result.adjustedReferenceRent.monthlyRent, 505.5);
  assert.equal(result.contractRentComparison.differenceFromThreshold, 225, "the rent is still compared with the range");
  assert.match(answerOf(third), /adjusted reference rent is 505,50 €/);
  assert.match(answerOf(third), /not legal advice/);
  assert.equal(models.supervisor.remaining, 0, "no grounding rewrite was needed");
  assert.equal(third.at(-1).type, "done");
});

test("with four of five ratings no feature groups are passed, whatever the model supplies", async () => {
  const { orchestrator, calls } = setup({
    router: [{ intents: ["mietspiegel"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          recordFacts([
            ...FLAT_FACTS,
            ...ratingFacts({ bathroom: "positive", kitchen: "positive", apartment: "positive", building: "positive" }),
          ]),
          ...askOfficialData.toolCalls,
          ...askMietspiegel.toolCalls,
        ],
      },
      "The reference range is 410–555 €. How do the surroundings compare with usual?",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      // The model makes up the missing rating.
      {
        toolCalls: [
          {
            name: "calculate_mietspiegel",
            args: {
              ...mietspiegelArgs(780),
              featureGroups: {
                bathroom: "positive",
                kitchen: "positive",
                apartment: "positive",
                building: "positive",
                surroundings: "positive",
              },
            },
          },
        ],
      },
      "Calculated.",
    ],
  });

  await collect(orchestrator.send({ threadId: "t61", message: "Berliner Str. 155, 50 m², 780 €; bath, kitchen, flat, building all better" }));

  assert.deepEqual(calls.at(-1), { name: "calculate_mietspiegel", args: pinnedMietspiegelArgs(780) });
});

test("correcting one rating changes only that fact and the adjusted rent on re-run", async () => {
  const ratings = { bathroom: "positive", kitchen: "positive", apartment: "neutral", building: "negative", surroundings: "positive" };
  const { orchestrator, models, calls } = setup({
    router: [
      { intents: ["mietspiegel"], language: "en" },
      { intents: ["mietspiegel"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          recordFacts([...FLAT_FACTS, ...ratingFacts(ratings)]),
          ...askOfficialData.toolCalls,
          ...askMietspiegel.toolCalls,
        ],
      },
      "Estimated from the Orientierungshilfe, your adjusted reference rent is 505,50 €; the range of 410–555 € remains the reference.",
      { toolCalls: [recordFacts(ratingFacts({ surroundings: "neutral" })), ...askMietspiegel.toolCalls] },
      "With average surroundings the estimate is 489 €; the range of 410–555 € remains the reference.",
    ],
    subAgent: [...OFFICIAL_DATA_SCRIPT, mietspiegelCall(780), "Calculated.", mietspiegelCall(780), "Calculated."],
  });

  await collect(orchestrator.send({ threadId: "t62", message: "Berliner Str. 155, 50 m², 780 €, and my ratings" }));
  const before = await orchestrator.getTenancy("t62");
  const events = await collect(orchestrator.send({ threadId: "t62", message: "Actually the surroundings are just average" }));
  const after = await orchestrator.getTenancy("t62");

  assert.deepEqual(after, { ...before, surroundingsRating: { value: "neutral", source: "user" } });
  const featureGroups = calls.filter((c) => c.name === "calculate_mietspiegel").map((c) => c.args.featureGroups);
  assert.deepEqual(featureGroups, [ratings, { ...ratings, surroundings: "neutral" }]);
  assert.equal(lastMietspiegelReport(models).adjustedReferenceRent.monthlyRent, 489);
  assert.match(answerOf(events), /estimate is 489 €/);
});

test("a new address clears the feature group ratings", async () => {
  const { orchestrator } = setup({
    router: [
      { intents: ["mietspiegel"], language: "en" },
      { intents: ["address"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          recordFacts([
            ...FLAT_FACTS,
            ...ratingFacts({ bathroom: "positive", kitchen: "positive", apartment: "neutral", building: "negative", surroundings: "positive" }),
          ]),
          ...askOfficialData.toolCalls,
        ],
      },
      "Noted your flat at Berliner Straße 155 and your ratings.",
      { toolCalls: [recordFacts([{ fact: "address", value: "Karl-Marx-Allee 1" }])] },
      "Noted your new address, Karl-Marx-Allee 1.",
    ],
    subAgent: OFFICIAL_DATA_SCRIPT,
  });

  await collect(orchestrator.send({ threadId: "t63", message: "Berliner Str. 155, 50 m², 780 €, and my ratings" }));
  const events = await collect(orchestrator.send({ threadId: "t63", message: "I moved to Karl-Marx-Allee 1" }));

  const tenancy = await orchestrator.getTenancy("t63");
  assert.deepEqual(
    Object.keys(tenancy).toSorted(),
    ["address", "contractRent", "livingAreaSqm"],
    "the ratings and 'rented before' describe the old flat",
  );
  assert.deepEqual(events.find((e) => e.type === "tenancy").tenancy, tenancy);
});

test("a rent check asks whether the flat was rented before, and 'yes' gives a conditional rent cap verdict", async () => {
  const { orchestrator, models, calls } = setup({
    router: [
      { intents: ["address", "mietspiegel"], language: "en" },
      { intents: ["mietspiegel"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          recordFacts(FLAT_FACTS.filter(({ fact }) => fact !== "rentedBefore")),
          ...askOfficialData.toolCalls,
          ...askMietspiegel.toolCalls,
        ],
      },
      "Was the flat rented out before you moved in?",
      { toolCalls: [recordFacts([{ fact: "rentedBefore", value: "yes" }]), ...askMietspiegel.toolCalls] },
      "Your Nettokaltmiete (net cold rent) of 780 € is above the Mietspiegel range of 410–555 €. " +
        "Mietpreisbremse (rent cap): the cap is Mietspiegel + 10 %, i.e. 519,75 €, and your rent is 260,25 € above it. " +
        "As the flat was rented before, a higher previous rent (Vormiete) could justify a higher rent; you can ask your landlord to disclose it (§ 556g BGB). " +
        "This assumes 780 € is the rent agreed at the start of the lease. Not checked: leases concluded before 1 June 2015, modernisation, Staffelmiete and Indexmiete.",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      // The model passes the opposite of what the tenant said; the Tenancy is pinned instead.
      { toolCalls: [{ name: "calculate_mietspiegel", args: { ...mietspiegelArgs(780), rentedBefore: false } }] },
      "Calculated; above the rent cap, conditional.",
    ],
  });

  const first = await collect(orchestrator.send({ threadId: "t70", message: "Berliner Str. 155, 50 m², 780 € cold. Too much?" }));

  assert.deepEqual(stepsOf(first), ["OfficialDataAgent:started", "OfficialDataAgent:finished", "ComplianceAgent:needs_facts"]);
  assert.equal(calls.some((c) => c.name === "calculate_mietspiegel"), false, "no Mietspiegel call yet");
  assert.deepEqual(JSON.parse(models.supervisor.calls[1].at(-1).content), {
    status: "needs_facts",
    checks: ["mietspiegel"],
    missing: ["rentedBefore"],
    unconfirmed: [],
  });

  const second = await collect(orchestrator.send({ threadId: "t70", message: "yes" }));

  assert.deepEqual((await orchestrator.getTenancy("t70")).rentedBefore, { value: true, source: "user" });
  assert.deepEqual(stepsOf(second), ["ComplianceAgent:started", "ComplianceAgent:finished"]);
  assert.deepEqual(calls.at(-1), { name: "calculate_mietspiegel", args: pinnedMietspiegelArgs(780) });
  const { rentCap } = lastMietspiegelReport(models);
  assert.equal(rentCap.conditional, true);
  assert.equal(rentCap.capMonthlyRent, 519.75);
  const answer = answerOf(second);
  assert.match(answer, /519,75 €/);
  assert.match(answer, /10 %/);
  assert.match(answer, /1 June 2015/);
  assert.match(answer, /not legal advice/);
  assert.equal(models.supervisor.remaining, 0, "no grounding rewrite was needed");
});

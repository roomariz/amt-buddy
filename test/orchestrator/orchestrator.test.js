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

test("send() rejects a call without threadId, and one without message, document or confirmation", async () => {
  const { orchestrator } = setup();
  await assert.rejects(collect(orchestrator.send({ message: "hi" })), /requires a threadId/);
  await assert.rejects(collect(orchestrator.send({ threadId: "t5" })), /requires a message/);
  await assert.rejects(collect(orchestrator.send({ threadId: "t5", message: "   " })), /requires a message/);
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

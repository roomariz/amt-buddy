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
  const orchestrator = createOrchestrator({ models, tools });
  return { orchestrator, models, calls };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");

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

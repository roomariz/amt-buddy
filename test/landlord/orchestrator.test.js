import test from "node:test";
import assert from "node:assert/strict";

import { createLandlordOrchestrator, createLandlordStubTools } from "../../src/landlord/orchestrator/index.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";

function setup({ script = [], toolOverrides, context = {} } = {}) {
  const model = new ScriptedChatModel(script);
  const { tools, calls } = createLandlordStubTools(toolOverrides);
  const logs = [];
  const orchestrator = createLandlordOrchestrator({
    model,
    tools,
    getContext: async () => context,
    log: (entry) => logs.push(entry),
    toolTimeoutMs: 50,
  });
  return { orchestrator, model, calls, logs };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const typesOf = (events) => events.map((e) => e.type);

test("a question about the ranking calls get_ranking and answers from its result", async () => {
  const { orchestrator, model, calls, logs } = setup({
    script: [
      { toolCalls: [{ name: "get_ranking", args: {} }] },
      "Applicant A-001 leads with a Match score of 94; 27 of 42 applicants can afford the rent.",
    ],
  });

  const events = await collect(orchestrator.send({ landlordId: "l-1", message: "Who is my best applicant?" }));

  assert.deepEqual(typesOf(events), ["token", "done"]);
  assert.equal(answerOf(events), "Applicant A-001 leads with a Match score of 94; 27 of 42 applicants can afford the rent.");
  assert.deepEqual(calls, [{ name: "get_ranking", args: {}, landlordId: "l-1" }], "the Tool learns whose ranking it is");
  const toolResult = model.calls[1].at(-1);
  assert.equal(toolResult.name, "get_ranking");
  assert.match(toolResult.content, /"matchScore":94/);
  assert.deepEqual(
    logs.map(({ event, tool, argKeys, outcome }) => ({ event, tool, argKeys, outcome })),
    [{ event: "tool_call", tool: "get_ranking", argKeys: [], outcome: "ok" }],
  );
});

test("an ungrounded number is caught: the agent rewrites once with a correction note naming it", async () => {
  const { orchestrator, model } = setup({
    script: [
      { toolCalls: [{ name: "get_ranking", args: {} }] },
      "A-001 leads with 97 points.",
      "A-001 leads with a Match score of 94.",
    ],
  });

  const events = await collect(orchestrator.send({ landlordId: "l-1", message: "Who leads?" }));

  assert.equal(answerOf(events), "A-001 leads with a Match score of 94.", "only the checked answer is emitted");
  assert.equal(model.calls.length, 3);
  assert.doesNotMatch(model.calls[1][0].content, /Correction/);
  assert.match(model.calls[2][0].content, /Correction: .*not backed by any tool result.*: 97\./);
});

test("a rewrite that is still ungrounded loses the offending sentences, with a note in the landlord's language", async () => {
  const { orchestrator } = setup({
    script: ["Ihre Miete ist 12 % zu hoch. Fragen Sie mich gern.", "Die Miete liegt 12 % zu hoch. Fragen Sie mich gern nach Bewerbern."],
  });

  const answer = answerOf(await collect(orchestrator.send({ landlordId: "l-1", message: "Ist meine Miete zu hoch?" })));

  assert.doesNotMatch(answer, /12/);
  assert.match(answer, /^Fragen Sie mich gern nach Bewerbern\./);
  assert.match(answer, /Zahlen, die ich nicht mit den Daten belegen konnte, habe ich weggelassen\./);
});

test("a rewrite with nothing grounded left is replaced by a fallback question", async () => {
  const { orchestrator } = setup({ script: ["It is 12 %.", "About 15 %."] });

  const answer = answerOf(await collect(orchestrator.send({ landlordId: "l-1", message: "Is my rent too high?" })));

  assert.match(answer, /^I couldn't back my answer with your data\./);
  assert.doesNotMatch(answer, /%/);
});

test("figures from the Listing and from the landlord's own message are grounded; a Tool result from an earlier turn is not", async () => {
  const listing = { livingAreaSqm: 50, rooms: 2, askingRent: 700, rentCheck: { allowedRent: 539 } };
  const { orchestrator, model } = setup({
    context: { listing },
    script: [
      "Your 50 m² flat with 2 rooms is offered at 700 €; at most 539 € are allowed. You could ask 650 € instead.",
      { toolCalls: [{ name: "get_ranking", args: {} }] },
      "A-001 leads with 94.",
      "A-001 still leads with 94.",
      "A-001 leads.",
    ],
  });

  const first = answerOf(await collect(orchestrator.send({ landlordId: "l-1", message: "Should I ask 650 € instead?" })));
  assert.match(first, /^Your 50 m² flat/);
  assert.equal(model.calls.length, 1, "no rewrite");

  await collect(orchestrator.send({ landlordId: "l-1", message: "Who leads?" }));
  const third = answerOf(await collect(orchestrator.send({ landlordId: "l-1", message: "And now?" })));
  assert.equal(model.calls.length, 5, "the earlier turn's ranking does not ground this turn's figure");
  assert.equal(third, "A-001 leads.");
});

test("a preference that changes the Selection criteria emits a criteria event", async () => {
  const { orchestrator, calls } = setup({
    script: [
      { toolCalls: [{ name: "update_selection_criteria", args: { weights: { employment: 30 }, requirements: { schufaCleanOnly: true } } }] },
      "Ich habe die Gewichtung der Beschäftigung von 15 auf 30 erhöht und nur saubere SCHUFA zugelassen.",
    ],
  });

  const events = await collect(
    orchestrator.send({ landlordId: "l-1", message: "Stabiles Einkommen ist mir am wichtigsten, und nur saubere SCHUFA." }),
  );

  assert.deepEqual(typesOf(events), ["criteria", "token", "done"]);
  assert.deepEqual(calls.map(({ name, landlordId }) => ({ name, landlordId })), [{ name: "update_selection_criteria", landlordId: "l-1" }]);
});

test("a Shortlist change emits a shortlist event", async () => {
  const { orchestrator } = setup({
    script: [
      { toolCalls: [{ name: "update_shortlist", args: { applicantId: "A-004", status: "to_invite" } }] },
      "A-004 is on your Shortlist, to invite.",
    ],
  });

  const events = await collect(orchestrator.send({ landlordId: "l-1", message: "Put A-004 on my shortlist" }));

  assert.deepEqual(typesOf(events), ["shortlist", "token", "done"]);
  assert.equal(answerOf(events), "A-004 is on your Shortlist, to invite.", "the applicant id is not an ungrounded figure");
});

test("a Tool call that fails emits no change event and the model learns the error", async () => {
  const { orchestrator, model, logs } = setup({
    toolOverrides: {
      update_shortlist: () => {
        throw Object.assign(new Error("There is no applicant with the id A-999."), { kind: "input" });
      },
    },
    script: [
      { toolCalls: [{ name: "update_shortlist", args: { applicantId: "A-999", status: "to_invite" } }] },
      "There is no applicant A-999.",
    ],
  });

  const events = await collect(orchestrator.send({ landlordId: "l-1", message: "Shortlist A-999" }));

  assert.deepEqual(typesOf(events), ["token", "done"]);
  assert.match(model.calls[1].at(-1).content, /"error":"input".*no applicant with the id A-999/);
  assert.equal(logs[0].errorKind, "input");
});

test("the system prompt carries the Listing, the AGG refusal rule and the landlord's language, every turn", async () => {
  const listing = { askingRent: 700, rentCheck: { allowedRent: 539 } };
  const { orchestrator, model } = setup({ context: { listing }, script: ["Gern.", "Sure."] });

  await collect(orchestrator.send({ landlordId: "l-1", message: "Bitte nur deutsche Bewerber." }));
  await collect(orchestrator.send({ landlordId: "l-1", message: "What about the rent?" }));

  const [german, english] = model.calls.map((messages) => messages[0].content);
  assert.match(german, /"askingRent":700/);
  assert.match(german, /Never rank, select, exclude or comment on applicants by protected characteristics under the AGG/);
  assert.match(german, /refuse politely/);
  assert.match(german, /the landlord's page also identifies them by id only/);
  assert.match(german, /Reply in German/);
  assert.match(english, /Reply in English/);
  assert.match(english, /"askingRent":700/);
  assert.equal(model.calls[1].length, 4, "the conversation persists per landlord: system, two messages and the answer");
});

test("each landlord has their own conversation", async () => {
  const { orchestrator, model } = setup({ script: ["Hello.", "Hello."] });

  await collect(orchestrator.send({ landlordId: "l-1", message: "Hi" }));
  await collect(orchestrator.send({ landlordId: "l-2", message: "Hi" }));

  assert.equal(model.calls[1].length, 2, "system prompt and l-2's own message only");
});

test("send() rejects a call without landlordId or without a message", async () => {
  const { orchestrator } = setup();
  await assert.rejects(collect(orchestrator.send({ message: "Hi" })), /landlordId/);
  await assert.rejects(collect(orchestrator.send({ landlordId: "l-1", message: "  " })), /message/);
});

test("a model failure ends the turn with an error event", async () => {
  const { orchestrator } = setup({ script: [] });
  const events = await collect(orchestrator.send({ landlordId: "l-1", message: "Hi" }));
  assert.deepEqual(typesOf(events), ["error"]);
});

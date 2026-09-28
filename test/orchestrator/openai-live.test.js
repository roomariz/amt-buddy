import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator, createStubTools } from "../../src/orchestrator/index.js";
import { createOpenAIModels } from "../../src/orchestrator/openai.js";

// The live tests call the real OpenAI API (stub Tools, so no Berlin services) and
// run only when both variables are set; `npm test` stays offline otherwise.
const live = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());
const liveOptions = { skip: live ? false : "set OPENAI_API_KEY and OPENAI_MODEL to run", timeout: 180_000 };

function liveOrchestrator() {
  return createOrchestrator({ models: createOpenAIModels(), tools: createStubTools().tools, log: () => {} });
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const complianceFinished = (events) =>
  events.some((e) => e.type === "agent_step" && e.agent === "ComplianceAgent" && e.status === "finished");

test("createOpenAIModels requires OPENAI_MODEL", () => {
  assert.throws(() => createOpenAIModels({}), /Set OPENAI_MODEL/);
});

test("createOpenAIModels takes every model name from the environment", () => {
  const env = { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "main-model", OPENAI_ROUTER_MODEL: "router-model" };

  const models = createOpenAIModels(env);
  assert.equal(models.supervisor.model, "main-model");
  assert.equal(models.subAgent.model, "main-model");
  assert.equal(models.router.model, "router-model");

  const withoutRouter = createOpenAIModels({ OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "main-model" });
  assert.equal(withoutRouter.router.model, "main-model");
});

test("live: a German Mietspiegel question gets a full check against the real model", liveOptions, async () => {
  const orchestrator = liveOrchestrator();

  const events = await collect(
    orchestrator.send({
      threadId: "live-mietspiegel",
      message: "Berliner Straße 155, 10715 Berlin, 50 m², Nettokaltmiete 780 €. Zahle ich zu viel?",
    }),
  );

  assert.equal(events.at(-1).type, "done", JSON.stringify(events.at(-1)));
  assert.ok(complianceFinished(events), JSON.stringify(events));
  assert.match(answerOf(events), /Rechtsberatung/, "German disclaimer");
});

// Re-running the waiting check after a confirmation is a Supervisor prompt rule, not code:
// this is the check that a real model follows it.
test("live: confirming the lease's unconfirmed rent re-runs the Mietspiegel check", liveOptions, async () => {
  const orchestrator = liveOrchestrator();
  const threadId = "live-lease-confirm";

  const upload = await collect(
    orchestrator.send({ threadId, documentId: "lease-1", message: "Hier ist mein Mietvertrag. Zahle ich zu viel Miete?" }),
  );
  assert.equal(upload.at(-1).type, "done", JSON.stringify(upload.at(-1)));
  assert.ok(!complianceFinished(upload), "no verdict on the Unconfirmed contract rent");

  const confirmed = await collect(orchestrator.send({ threadId, confirm: { contractRent: 780 } }));
  assert.equal(confirmed.at(-1).type, "done", JSON.stringify(confirmed.at(-1)));
  assert.ok(complianceFinished(confirmed), JSON.stringify(confirmed));
  assert.match(answerOf(confirmed), /Rechtsberatung/, "German disclaimer");
});

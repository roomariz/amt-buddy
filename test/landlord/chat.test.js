import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordOrchestrator, createLandlordStubTools } from "../../src/landlord/orchestrator/index.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";

const OPENAI_ENV = { OPENAI_MODEL: "scripted", OPENAI_API_KEY: "sk-test" };

// Starts the app with an in-memory landlord store and the Berlin WFS faked. With `script`, the
// Landlord Orchestrator runs a scripted model on the stub Tools, with the app's own context.
async function start({ env = OPENAI_ENV, script = [] } = {}) {
  const built = [];
  const app = createApp({
    env,
    landlordStore: createLandlordStore({ path: ":memory:" }),
    fetchImpl: createFakeBerlinWfs().fetchImpl,
    createLandlordChat: ({ getContext }) => {
      const model = new ScriptedChatModel(script);
      const created = createLandlordOrchestrator({ model, tools: createLandlordStubTools().tools, getContext, log: () => {} });
      built.push({ model });
      return created;
    },
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (method, path, body) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    built,
    close: () => new Promise((resolve) => app.close(resolve)),
    request,
    signIn: async (name = "Erika Muster") =>
      (await (await request("POST", "/api/v1/landlord/sessions", { name })).json()).data.landlordId,
    chat: async (landlordId, body) => {
      const response = await request("POST", `/api/v1/landlord/${landlordId}/chat`, body);
      const text = await response.text();
      const isStream = response.headers.get("content-type")?.startsWith("text/event-stream");
      return { status: response.status, headers: response.headers, events: isStream ? parseSse(text) : null, body: isStream ? null : JSON.parse(text) };
    },
  };
}

// A complete SSE body → its events, checking each event's name matches its data's type.
function parseSse(text) {
  return text
    .split("\n\n")
    .filter((block) => block.trim() && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
      const data = JSON.parse(lines.find((l) => l.startsWith("data: ")).slice(6));
      assert.equal(event, data.type);
      return data;
    });
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");

test("the landlord chat streams the Orchestrator's events as SSE, criteria event included", async (t) => {
  const server = await start({
    script: [
      { toolCalls: [{ name: "update_selection_criteria", args: { changes: [{ requirement: "schufaCleanOnly", value: true }] } }] },
      "From now on only applicants with a clean SCHUFA are ranked.",
    ],
  });
  t.after(server.close);
  const landlordId = await server.signIn();

  const { status, headers, events } = await server.chat(landlordId, { message: "Only clean SCHUFA please" });

  assert.equal(status, 200);
  assert.match(headers.get("content-type"), /^text\/event-stream/);
  assert.deepEqual(events, [
    { type: "criteria" },
    { type: "token", text: "From now on only applicants with a clean SCHUFA are ranked." },
    { type: "done" },
  ]);
});

test("the landlord's saved Listing reaches the system prompt, so its figures are grounded", async (t) => {
  const server = await start({ script: ["Your asking rent of 700 € is above the allowed 539 €."] });
  t.after(server.close);
  const landlordId = await server.signIn();
  await server.request("PUT", `/api/v1/landlord/${landlordId}/listing`, {
    address: "Wühlischstraße 30, 10245 Berlin",
    livingAreaSqm: 50,
    rooms: 2,
    askingRent: 700,
  });

  const { events } = await server.chat(landlordId, { message: "Is my rent ok?" });

  assert.equal(answerOf(events), "Your asking rent of 700 € is above the allowed 539 €.");
  const system = server.built[0].model.calls[0][0].content;
  assert.match(system, /"allowedRent":539/);
  assert.doesNotMatch(system, /Erika/, "the landlord's name does not reach the model");
});

test("without OPENAI_MODEL / OPENAI_API_KEY the chat streams one 'AI chat not configured' answer, in the landlord's language", async (t) => {
  const server = await start({ env: { OPENAI_MODEL: "gpt-x" } });
  t.after(server.close);
  const landlordId = await server.signIn();

  const english = await server.chat(landlordId, { message: "Who is my best applicant?" });
  const german = await server.chat(landlordId, { message: "Wer ist mein bester Bewerber?" });

  assert.equal(english.status, 200);
  assert.deepEqual(english.events.map((e) => e.type), ["token", "done"]);
  assert.match(answerOf(english.events), /AI chat is not configured/);
  assert.match(answerOf(german.events), /KI-Chat ist auf diesem Server nicht eingerichtet/);
  assert.equal(server.built.length, 0, "no Orchestrator is built");
});

test("a chat request without a usable message is a 422 before streaming", async (t) => {
  const server = await start();
  t.after(server.close);
  const landlordId = await server.signIn();

  for (const body of [{}, { message: "   " }, { message: 42 }, { message: "x".repeat(4001) }, [], "not json"]) {
    const { status, body: error } = await server.chat(landlordId, body);
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(error.error.code, "validation_error");
  }
  assert.equal(server.built.length, 0);
});

test("chatting as an unknown landlord is a 404", async (t) => {
  const server = await start();
  t.after(server.close);

  const { status, body } = await server.chat("no-such-landlord", { message: "Hi" });

  assert.equal(status, 404);
  assert.equal(body.error.code, "landlord_not_found");
});

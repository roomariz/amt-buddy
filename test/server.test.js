import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";

import { createApp } from "../src/app.js";
import { processChat } from "../src/chatbot-orchestrator.js";
import { processDocumentOcr } from "../src/ocr-extraction.js";
import { createBerlinTools } from "../src/orchestrator/berlin-tools.js";
import { createOrchestrator } from "../src/orchestrator/index.js";
import { createFakeBerlinWfs } from "./helpers/fake-berlin-wfs.js";
import { ScriptedChatModel } from "./orchestrator/helpers/scripted-model.js";

const OPENAI_ENV = { OPENAI_MODEL: "scripted", OPENAI_API_KEY: "sk-test" };

// Starts the app on a free port; `script` is the scripted Orchestrator's models, backed by
// the real Berlin Tools on the fake WFS and the app's own document store.
async function start({ env = OPENAI_ENV, script, orchestrator } = {}) {
  const built = [];
  const app = createApp({
    env,
    createChatOrchestrator: ({ documents }) => {
      if (orchestrator) return orchestrator;
      const models = {
        router: new ScriptedChatModel(script?.router ?? []),
        supervisor: new ScriptedChatModel(script?.supervisor ?? []),
        subAgent: new ScriptedChatModel(script?.subAgent ?? []),
      };
      const tools = createBerlinTools({ fetchImpl: createFakeBerlinWfs().fetchImpl, documents }).tools;
      const created = createOrchestrator({ models, tools, log: () => {} });
      built.push({ models, orchestrator: created });
      return created;
    },
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return {
    base,
    built,
    close: () => new Promise((resolve) => app.close(resolve)),
    getJson: async (path) => {
      const response = await fetch(base + path);
      return { status: response.status, body: await response.json() };
    },
    postJson: async (path, body) => {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    chat: async (body) => {
      const response = await fetch(`${base}/api/v1/orchestrator/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, headers: response.headers, events: parseSse(await response.text()) };
    },
  };
}

// Parses a complete SSE body into [{ event, data }], checking each event's name matches its data's type.
function parseSse(text) {
  return text
    .split("\n\n")
    .filter((block) => block.trim() && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
      const data = JSON.parse(lines.find((l) => l.startsWith("data: ")).slice(6));
      assert.equal(event, data.type, "the SSE event name is the Orchestrator event's type");
      return data;
    });
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const stepsOf = (events) => events.filter((e) => e.type === "agent_step").map((e) => `${e.agent}:${e.status}`);
const terminals = (events) => events.filter((e) => e.type === "done" || e.type === "error");

const askLeaseAnalysis = { toolCalls: [{ name: "ask_lease_analysis_agent", args: { request: "Read the lease" } }] };

const WUEHLISCH_SCRIPT = {
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
};

test("with OpenAI configured, status reports the orchestrator without building it", async (t) => {
  const server = await start();
  t.after(server.close);

  const { status, body } = await server.getJson("/api/v1/orchestrator/status");

  assert.equal(status, 200);
  assert.deepEqual(body, { data: { mode: "orchestrator" } });
  assert.equal(server.built.length, 0, "the Orchestrator is created lazily, on the first chat turn");
});

test("the chat endpoint streams the Orchestrator's events in order as SSE, ending with exactly one done", async (t) => {
  const server = await start({ script: WUEHLISCH_SCRIPT });
  t.after(server.close);

  const { status, headers, events } = await server.chat({
    threadId: "sse-1",
    message: "Wühlischstr. 30 10245, 50 m², 700 € kalt. Zahle ich zu viel?",
  });

  assert.equal(status, 200);
  assert.match(headers.get("content-type"), /^text\/event-stream/);
  assert.equal(headers.get("cache-control"), "no-cache, no-transform");
  assert.deepEqual(events[0], { type: "intent", intents: ["address", "mietspiegel"] });
  assert.deepEqual(stepsOf(events), [
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:started",
    "ComplianceAgent:finished",
  ]);
  assert.ok(events.some((e) => e.type === "tenancy" && e.tenancy.residentialLocation?.value === "gut"));
  assert.match(answerOf(events), /90,00 € über der Obergrenze/);
  assert.match(answerOf(events), /keine Rechtsberatung/);
  assert.deepEqual(terminals(events), [{ type: "done" }]);
  assert.equal(events.at(-1).type, "done");
});

test("one Orchestrator serves every turn: the thread continues on the next request", async (t) => {
  const server = await start({
    script: {
      router: [
        { intents: ["general"], language: "en" },
        { intents: ["general"], language: "en" },
      ],
      supervisor: ["Hello! Ask me about your Berlin flat.", "Sure, tell me your address."],
    },
  });
  t.after(server.close);

  await server.chat({ threadId: "sse-2", message: "Hi" });
  const { events } = await server.chat({ threadId: "sse-2", message: "Can you check my rent?" });

  assert.equal(server.built.length, 1);
  const secondCall = server.built[0].models.supervisor.calls[1].map((m) => m.content).join("\n");
  assert.match(secondCall, /Hello! Ask me about your Berlin flat\./, "the Supervisor sees the earlier turn");
  assert.equal(answerOf(events), "Sure, tell me your address.", "no disclaimer after the first answer");
});

test("an uploaded lease is read by Lease Analysis, and its low-confidence rent arrives as an Unconfirmed fact", async (t) => {
  const server = await start({
    script: {
      router: [{ intents: ["document", "mietspiegel"], language: "de" }],
      supervisor: [
        askLeaseAnalysis,
        "In Ihrem Mietvertrag habe ich eine Nettokaltmiete von 30000 € gelesen, bin mir aber nicht sicher. Stimmt das?",
      ],
      subAgent: [
        { toolCalls: [{ name: "extract_lease_data", args: { documentId: "lease.pdf" } }] },
        "Extracted address, living area, rooms and a contract rent with confidence 0.5.",
      ],
    },
  });
  t.after(server.close);
  const text = [
    "Mietvertrag",
    "Mietobjekt: Wühlischstraße 30, 10245 Berlin",
    "Wohnfläche: 50 m²",
    "Zimmer: 2",
    "Nettokaltmiete: 30.000,00 EUR",
  ].join("\n");

  const upload = await server.postJson("/api/v1/orchestrator/documents", { text });
  assert.equal(upload.status, 201);
  const { documentId, expiresAt, extraction } = upload.body.data;
  assert.match(documentId, /^[0-9a-f-]{36}$/);
  assert.ok(Date.parse(expiresAt) > Date.now());
  assert.equal(extraction.fields.contractRent, 30000);
  assert.equal(extraction.confidence.contractRent, 0.5);

  const { events } = await server.chat({ threadId: "sse-3", message: "Zahle ich zu viel?", documentId });

  assert.deepEqual(stepsOf(events), ["LeaseAnalysisAgent:started", "LeaseAnalysisAgent:finished"]);
  const tenancy = events.find((e) => e.type === "tenancy").tenancy;
  assert.deepEqual(tenancy.contractRent, { value: 30000, source: "lease", confidence: 0.5 });
  assert.deepEqual(tenancy.livingAreaSqm, { value: 50, source: "lease", confidence: 0.95 });
  assert.deepEqual(tenancy.address, { value: "Wühlischstraße 30, 10245 Berlin", source: "lease", confidence: 0.95 });
  assert.match(answerOf(events), /30000 € gelesen/);
  assert.deepEqual(terminals(events), [{ type: "done" }]);
});

test("an unknown or expired documentId ends the turn with a request to upload again, not a crash", async (t) => {
  const server = await start({
    script: {
      router: [{ intents: ["document"], language: "de" }],
      supervisor: [askLeaseAnalysis, "Ich konnte Ihren Mietvertrag nicht finden. Bitte laden Sie ihn erneut hoch."],
      subAgent: [
        { toolCalls: [{ name: "extract_lease_data", args: { documentId: "x" } }] },
        "The document is unknown or has expired.",
      ],
    },
  });
  t.after(server.close);

  const { events } = await server.chat({ threadId: "sse-4", documentId: "3f1c2d4e-0000-4000-8000-000000000000" });

  assert.deepEqual(stepsOf(events), ["LeaseAnalysisAgent:started", "LeaseAnalysisAgent:finished"]);
  const leaseReport = server.built[0].models.supervisor.calls[1].at(-1).content;
  assert.match(leaseReport, /unknown or has expired/, "the Supervisor learns why, as an input error");
  assert.match(answerOf(events), /Bitte laden Sie ihn erneut hoch/);
  assert.deepEqual(terminals(events), [{ type: "done" }]);
});

test("the chat endpoint rejects a request it cannot run with a JSON validation error, before streaming", async (t) => {
  const server = await start();
  t.after(server.close);

  for (const body of [{ message: "Hi" }, { threadId: "t" }, { threadId: "t", confirm: "yes" }, { threadId: 5, message: "Hi" }]) {
    const { status, body: error } = await server.postJson("/api/v1/orchestrator/chat", body);
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(error.error.code, "validation_error");
  }
  assert.equal(server.built.length, 0);
});

test("a client that disconnects mid-turn aborts the Orchestrator run", async (t) => {
  let aborted;
  const abortedSeen = new Promise((resolve) => (aborted = resolve));
  const orchestrator = {
    async *send({ signal }) {
      yield { type: "intent", intents: ["general"] };
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      aborted(signal.aborted);
      yield { type: "error", message: "aborted" };
    },
  };
  const server = await start({ orchestrator });
  t.after(server.close);

  await new Promise((resolve, reject) => {
    const req = httpRequest(`${server.base}/api/v1/orchestrator/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    req.on("response", (response) => {
      response.once("data", () => {
        req.destroy();
        resolve();
      });
    });
    req.on("error", (error) => (error.code === "ECONNRESET" ? resolve() : reject(error)));
    req.end(JSON.stringify({ threadId: "sse-5", message: "Hi" }));
  });

  assert.equal(await abortedSeen, true);
});

test("without OpenAI configured, status reports rule_based and the chat endpoint streams the rule-based reply", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);
  const message = "Mindestfläche für 3 Personen mit 40 m² und 2 Zimmern";

  const status = await server.getJson("/api/v1/orchestrator/status");
  const { headers, events } = await server.chat({ threadId: "rb-1", message });

  assert.deepEqual(status.body, { data: { mode: "rule_based" } });
  assert.match(headers.get("content-type"), /^text\/event-stream/);
  assert.deepEqual(
    events.map((e) => e.type),
    ["token", "done"],
  );
  assert.equal(events[0].text, (await processChat({ message })).reply);
  assert.equal(server.built.length, 0, "no Orchestrator is built");
});

test("in rule_based mode an uploaded lease gets the rule-based document analysis", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);
  const text = "Mietvertrag\nMietobjekt: Wühlischstraße 30, 10245 Berlin\nWohnfläche: 50 m²\nNettokaltmiete: 700 EUR";
  const { documentId } = (await server.postJson("/api/v1/orchestrator/documents", { text })).body.data;

  const { events } = await server.chat({ threadId: "rb-2", documentId });

  assert.deepEqual(
    events.map((e) => e.type),
    ["token", "done"],
  );
  assert.match(events[0].text, /Mietvertrags-Analyse/);
  assert.match(events[0].text, /700 € \/ Monat/);
});

test("the existing chat and OCR endpoints answer as before", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);
  const text = "Mietvertrag\nMietobjekt: Wühlischstraße 30, 10245 Berlin\nNettokaltmiete: 700 EUR";

  const chat = await server.postJson("/api/v1/chat", { message: "Hallo" });
  const ocr = await server.postJson("/api/v1/documents/ocr", { text });

  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body, { data: await processChat({ message: "Hallo" }) });
  assert.equal(ocr.status, 200);
  assert.deepEqual(ocr.body, { data: await processDocumentOcr({ text }) });
});

test("the tenant chat is at /chat and /chatbot; the home page is the landlord page", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);
  const page = async (path) => {
    const response = await fetch(server.base + path);
    return { status: response.status, html: await response.text() };
  };

  const home = await page("/");
  const chat = await page("/chat");
  const chatbot = await page("/chatbot");

  assert.equal(chat.status, 200);
  assert.ok(chat.html.includes('src="/chatbot.js"'));
  assert.equal(chatbot.html, chat.html);
  assert.ok(home.html.includes('src="/landlord.js"'));
  assert.equal((await page("/app.js")).status, 404);
});

test("an upload the OCR cannot read is a 422 with the OCR's details, and nothing is stored", async (t) => {
  const server = await start();
  t.after(server.close);

  const { status, body } = await server.postJson("/api/v1/orchestrator/documents", { text: "   " });

  assert.equal(status, 422);
  assert.equal(body.error.code, "ocr_extraction_error");
  assert.equal(body.error.details[0].code, "empty_text");
});

test("in rule_based mode a confirm-only turn still gets a single reply and done", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);

  const { events } = await server.chat({ threadId: "rb-3", confirm: { contractRent: 780 } });

  assert.deepEqual(
    events.map((e) => e.type),
    ["token", "done"],
  );
});

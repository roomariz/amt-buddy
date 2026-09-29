// The /chatbot page's client code (public/chat/api.js) against the real server (src/app.js):
// the same calls the page makes, in both chat modes.
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createBerlinTools } from "../../src/orchestrator/berlin-tools.js";
import { createOrchestrator } from "../../src/orchestrator/index.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";
import { fetchChatMode, fetchThread, runTurn, uploadLease, UPLOAD_TEXT } from "../../public/chat/api.js";
import { confirmPayload } from "../../public/chat/tenancy.js";

async function start({ env, script }) {
  const app = createApp({
    env,
    createChatOrchestrator: ({ documents }) =>
      createOrchestrator({
        models: {
          router: new ScriptedChatModel(script?.router ?? []),
          supervisor: new ScriptedChatModel(script?.supervisor ?? []),
          subAgent: new ScriptedChatModel(script?.subAgent ?? []),
        },
        tools: createBerlinTools({ fetchImpl: createFakeBerlinWfs().fetchImpl, documents }).tools,
        log: () => {},
      }),
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return {
    // The page calls relative URLs; this is its fetch on this server.
    fetchImpl: (url, init) => fetch(base + url, init),
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}

const LEASE = [
  "Mietvertrag",
  "Mietobjekt: Wühlischstraße 30, 10245 Berlin",
  "Wohnfläche: 50 m²",
  "Zimmer: 2",
  "Nettokaltmiete: 30.000,00 EUR",
].join("\n");

const base64 = (text) => Buffer.from(text, "utf8").toString("base64");

test("rule_based mode: the page's status, upload and chat calls work, one code path", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);

  assert.equal(await fetchChatMode(server.fetchImpl), "rule_based");

  const { documentId } = await uploadLease({
    fetchImpl: server.fetchImpl,
    payload: { file: base64(LEASE), mimeType: "text/plain", fileName: "mietvertrag.txt" },
  });
  const upload = await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "page-1", documentId } });
  assert.equal(upload.phase, "done");
  assert.ok(upload.answer.length > 0);
  assert.deepEqual(upload.steps, [], "no agent steps in rule_based mode");

  const question = await runTurn({
    fetchImpl: server.fetchImpl,
    request: { threadId: "page-1", message: "Mietspiegel 60 m² gut 1905 900 €" },
  });
  assert.equal(question.phase, "done");
  assert.match(question.answer, /Mietspiegel/);
});

test("an unreadable upload is a friendly reason from the real server", async (t) => {
  const server = await start({ env: {} });
  t.after(server.close);
  await assert.rejects(
    uploadLease({ fetchImpl: server.fetchImpl, payload: { file: base64("x"), mimeType: "image/png", fileName: "scan.png" } }),
    { message: UPLOAD_TEXT.image },
  );
});

test("orchestrator mode: a lease with a low-confidence rent opens the review card, and confirming it continues the thread", async (t) => {
  const server = await start({
    env: { OPENAI_MODEL: "scripted", OPENAI_API_KEY: "sk-test" },
    script: {
      router: [{ intents: ["document"], language: "de" }],
      supervisor: [
        { toolCalls: [{ name: "ask_lease_analysis_agent", args: { request: "Read the lease" } }] },
        "In Ihrem Mietvertrag steht eine Nettokaltmiete von 30000 €. Stimmt das?",
        "Danke, ich rechne mit einer Nettokaltmiete von 780,5 €.",
      ],
      subAgent: [
        { toolCalls: [{ name: "extract_lease_data", args: { documentId: "lease" } }] },
        "Extracted the lease; the contract rent has confidence 0.5.",
      ],
    },
  });
  t.after(server.close);

  assert.equal(await fetchChatMode(server.fetchImpl), "orchestrator");
  const { documentId } = await uploadLease({
    fetchImpl: server.fetchImpl,
    payload: { file: base64(LEASE), mimeType: "text/plain", fileName: "mietvertrag.txt" },
  });

  const announced = [];
  const read = await runTurn({
    fetchImpl: server.fetchImpl,
    request: { threadId: "page-2", documentId },
    onChange: (next) => announced.push(next.steps.map((s) => s.status).join(",")),
  });
  assert.equal(read.phase, "done");
  assert.ok(announced.includes("running"), "the running Lease Analysis step was shown while streaming");
  assert.deepEqual(read.steps.map((s) => [s.agent, s.status]), [["LeaseAnalysisAgent", "done"]]);
  assert.deepEqual(
    read.review.fields.map(({ name, value, level, unconfirmed }) => ({ name, value, level, unconfirmed })),
    [
      { name: "contractRent", value: "30000", level: "low", unconfirmed: true },
      { name: "address", value: "Wühlischstraße 30, 10245 Berlin", level: "high", unconfirmed: false },
      { name: "livingAreaSqm", value: "50", level: "high", unconfirmed: false },
      { name: "rooms", value: "2", level: "high", unconfirmed: false },
    ],
  );

  const confirm = confirmPayload(read.review.fields, {
    contractRent: "780,50",
    address: "Wühlischstraße 30, 10245 Berlin",
    livingAreaSqm: "50",
    rooms: "2",
  });
  assert.deepEqual(confirm, { contractRent: "780,50" });

  const confirmed = await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "page-2", confirm } });
  assert.equal(confirmed.phase, "done");
  assert.deepEqual(confirmed.tenancy.contractRent, { value: 780.5, source: "user" });
  assert.equal(confirmed.review, null, "nothing left to confirm");
  assert.match(confirmed.answer, /780,5 €/);
});

const ORCHESTRATOR_ENV = { OPENAI_MODEL: "scripted", OPENAI_API_KEY: "sk-test" };

test("restore: after a question and answer, the thread holds both, the answer exactly as streamed", async (t) => {
  const server = await start({
    env: ORCHESTRATOR_ENV,
    script: {
      router: [{ intents: ["general"], language: "en" }],
      supervisor: ["Tell me your address and I will check the Mietspiegel."],
    },
  });
  t.after(server.close);

  const turn = await runTurn({
    fetchImpl: server.fetchImpl,
    request: { threadId: "restore-1", message: "  Can you check my rent?  " },
  });
  assert.equal(turn.phase, "done");
  assert.match(turn.answer, /legal advice/i, "the first answer carries the disclaimer");

  const thread = await fetchThread({ fetchImpl: server.fetchImpl, threadId: "restore-1" });
  assert.deepEqual(thread, {
    transcript: [
      { role: "user", text: "Can you check my rent?", document: false, confirm: null },
      { role: "assistant", text: turn.answer },
    ],
    tenancy: {},
  });
});

test("restore: Tool calls, Tool results and a rewritten draft never reach the Transcript", async (t) => {
  const server = await start({
    env: ORCHESTRATOR_ENV,
    script: {
      router: [{ intents: ["address"], language: "en" }],
      supervisor: [
        { toolCalls: [{ name: "record_tenancy_facts", args: { facts: [{ fact: "address", value: "Wühlischstraße 30, 10245 Berlin" }] } }] },
        "Your rent of 1234 € is too high.",
        "I noted your address. What is your contract rent?",
      ],
    },
  });
  t.after(server.close);

  const turn = await runTurn({
    fetchImpl: server.fetchImpl,
    request: { threadId: "restore-2", message: "I live in Wühlischstraße 30, 10245 Berlin" },
  });
  assert.equal(turn.phase, "done");
  assert.match(turn.answer, /^I noted your address/);

  const { transcript, tenancy } = await fetchThread({ fetchImpl: server.fetchImpl, threadId: "restore-2" });
  assert.deepEqual(transcript, [
    { role: "user", text: "I live in Wühlischstraße 30, 10245 Berlin", document: false, confirm: null },
    { role: "assistant", text: turn.answer },
  ]);
  assert.doesNotMatch(JSON.stringify(transcript), /1234/);
  assert.deepEqual(tenancy.address, { value: "Wühlischstraße 30, 10245 Berlin", source: "user" });
});

test("restore: an out-of-scope message and its reply are both kept, and new turns append below", async (t) => {
  const server = await start({
    env: ORCHESTRATOR_ENV,
    script: {
      router: [
        { intents: ["out_of_scope"], language: "en" },
        { intents: ["general"], language: "en" },
      ],
      supervisor: ["Ask me about renting in Berlin."],
    },
  });
  t.after(server.close);

  const rejected = await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "restore-3", message: "A poem, please" } });
  const next = await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "restore-3", message: "What can you do?" } });

  const { transcript } = await fetchThread({ fetchImpl: server.fetchImpl, threadId: "restore-3" });
  assert.deepEqual(
    transcript.map(({ role, text }) => [role, text]),
    [
      ["user", "A poem, please"],
      ["assistant", rejected.answer],
      ["user", "What can you do?"],
      ["assistant", next.answer],
    ],
  );
  assert.match(rejected.answer, /I can only help with Berlin housing questions/);
});

test("restore: a turn that ended in an error keeps the user's message without an answer", async (t) => {
  const server = await start({
    env: ORCHESTRATOR_ENV,
    // The Supervisor has no scripted reply: its model call fails.
    script: { router: [{ intents: ["general"], language: "en" }] },
  });
  t.after(server.close);

  const turn = await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "restore-4", message: "Hello?" } });
  assert.equal(turn.phase, "error");

  const { transcript } = await fetchThread({ fetchImpl: server.fetchImpl, threadId: "restore-4" });
  assert.deepEqual(transcript, [{ role: "user", text: "Hello?", document: false, confirm: null }]);
});

test("restore: two threads never see each other's Transcript", async (t) => {
  const server = await start({
    env: ORCHESTRATOR_ENV,
    script: {
      router: [
        { intents: ["general"], language: "en" },
        { intents: ["general"], language: "en" },
      ],
      supervisor: ["Answer for A.", "Answer for B."],
    },
  });
  t.after(server.close);

  await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "thread-a", message: "Question A" } });
  await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "thread-b", message: "Question B" } });

  const a = await fetchThread({ fetchImpl: server.fetchImpl, threadId: "thread-a" });
  const b = await fetchThread({ fetchImpl: server.fetchImpl, threadId: "thread-b" });
  assert.deepEqual(a.transcript.map((entry) => entry.text.split("\n")[0]), ["Question A", "Answer for A."]);
  assert.deepEqual(b.transcript.map((entry) => entry.text.split("\n")[0]), ["Question B", "Answer for B."]);
});

const EMPTY = { transcript: [], tenancy: {} };

test("restore: an unknown thread, a server without a chat turn yet and rule_based mode give an empty thread", async (t) => {
  let created = 0;
  const fresh = createApp({
    env: ORCHESTRATOR_ENV,
    createChatOrchestrator: () => {
      created += 1;
      throw new Error("must not be created by a restore");
    },
  });
  await new Promise((resolve) => fresh.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => fresh.close(resolve)));
  const freshFetch = (url, init) => fetch(`http://127.0.0.1:${fresh.address().port}${url}`, init);
  assert.deepEqual(await fetchThread({ fetchImpl: freshFetch, threadId: "never-sent" }), EMPTY);
  assert.equal(created, 0, "the endpoint never creates the Orchestrator");

  const ruleBased = await start({ env: {} });
  t.after(ruleBased.close);
  await runTurn({ fetchImpl: ruleBased.fetchImpl, request: { threadId: "rb-1", message: "Hallo" } });
  assert.deepEqual(await fetchThread({ fetchImpl: ruleBased.fetchImpl, threadId: "rb-1" }), EMPTY);

  const server = await start({
    env: ORCHESTRATOR_ENV,
    script: { router: [{ intents: ["general"], language: "en" }], supervisor: ["Hi."] },
  });
  t.after(server.close);
  await runTurn({ fetchImpl: server.fetchImpl, request: { threadId: "known", message: "Hi" } });
  assert.deepEqual(await fetchThread({ fetchImpl: server.fetchImpl, threadId: "unknown" }), EMPTY);
});

test("restore: an over-long or empty threadId is a validation error", async (t) => {
  const server = await start({ env: ORCHESTRATOR_ENV });
  t.after(server.close);

  const tooLong = await server.fetchImpl(`/api/v1/orchestrator/threads/${"x".repeat(201)}`);
  assert.equal(tooLong.status, 422);
  assert.equal((await tooLong.json()).error.code, "validation_error");

  const empty = await server.fetchImpl("/api/v1/orchestrator/threads/%20");
  assert.equal(empty.status, 422);

  assert.deepEqual(await fetchThread({ fetchImpl: server.fetchImpl, threadId: "x".repeat(201) }), EMPTY);
});

test("restore: a failed fetch gives an empty thread instead of throwing", async () => {
  const failing = async () => {
    throw new TypeError("Failed to fetch");
  };
  const serverError = async () => new Response("oops", { status: 500 });
  const malformed = async () => Response.json({ data: { transcript: "nope", tenancy: {} } });
  for (const fetchImpl of [failing, serverError, malformed]) {
    assert.deepEqual(await fetchThread({ fetchImpl, threadId: "t" }), EMPTY);
  }
});

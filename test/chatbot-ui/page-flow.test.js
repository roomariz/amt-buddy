// The /chatbot page's client code (public/chat/api.js) against the real server (src/app.js):
// the same calls the page makes, in both chat modes.
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createBerlinTools } from "../../src/orchestrator/berlin-tools.js";
import { createOrchestrator } from "../../src/orchestrator/index.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";
import { fetchChatMode, runTurn, uploadLease, UPLOAD_TEXT } from "../../public/chat/api.js";
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

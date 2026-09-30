// The landlord chat panel's logic (public/landlord/chat.js): folding the SSE events into what the
// panel shows, and running a turn against the real server (in-memory store, no network).
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordOrchestrator, createLandlordStubTools } from "../../src/landlord/orchestrator/index.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { signIn } from "../../public/landlord/api.js";
import {
  changedDashboard,
  endLandlordTurn,
  initialLandlordTurn,
  reduceLandlordTurn,
  runLandlordTurn,
} from "../../public/landlord/chat.js";
import { setLanguage } from "../../public/i18n.js";
import { TURN_TEXT } from "../../public/chat/turn.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";

const run = (events, state = initialLandlordTurn()) => events.reduce(reduceLandlordTurn, state);

async function start({ env = {}, script = [] } = {}) {
  const app = createApp({
    env,
    landlordStore: createLandlordStore({ path: ":memory:" }),
    createLandlordChat: ({ getContext }) =>
      createLandlordOrchestrator({
        model: new ScriptedChatModel(script),
        tools: createLandlordStubTools().tools,
        getContext,
        log: () => {},
      }),
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return {
    fetchImpl: (url, init) => fetch(base + url, init),
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}

test("a new turn is streaming with nothing to show and nothing changed", () => {
  assert.deepEqual(initialLandlordTurn(), {
    phase: "streaming",
    answer: "",
    error: null,
    changed: { criteria: false, shortlist: false, notes: false },
    signedOut: false,
  });
});

test("tokens make the answer, criteria and shortlist events mark what changed, done ends the turn", () => {
  const state = run([
    { type: "criteria" },
    { type: "shortlist" },
    { type: "token", text: "**Done:** " },
    { type: "token", text: "A-004 is shortlisted." },
    { type: "done" },
  ]);
  assert.equal(state.answer, "**Done:** A-004 is shortlisted.");
  assert.deepEqual(state.changed, { criteria: true, shortlist: true, notes: false });
  assert.equal(state.phase, "done");
});

test("a notes event marks that a Landlord preference was remembered", () => {
  assert.deepEqual(run([{ type: "notes" }, { type: "done" }]).changed, { criteria: false, shortlist: false, notes: true });
});

test("an error event ends the turn with a friendly text, and later events are ignored", () => {
  const state = run([{ type: "error", message: "GraphRecursionError" }, { type: "token", text: "late" }]);
  assert.equal(state.phase, "error");
  assert.equal(state.error, TURN_TEXT.failed);
  assert.equal(state.answer, "");
});

test("a stream that ends without done or error is a lost connection", () => {
  assert.equal(endLandlordTurn(initialLandlordTurn()).error, TURN_TEXT.connectionLost);
  assert.equal(endLandlordTurn(run([{ type: "done" }])).phase, "done");
});

test("in English the turn's own texts are English", (t) => {
  setLanguage("en");
  t.after(() => setLanguage("de"));
  assert.match(run([{ type: "error" }]).error, /^Amt-Buddy could not answer this message/);
});

test("a turn against the server without a model shows the 'not configured' answer", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const seen = [];

  const state = await runLandlordTurn({ fetchImpl, landlordId, message: "Wer ist mein bester Bewerber?", onChange: (next) => seen.push(next.phase) });

  assert.equal(state.phase, "done");
  assert.match(state.answer, /KI-Chat ist auf diesem Server nicht eingerichtet/);
  assert.equal(seen.at(-1), "done");
});

test("a turn that changes the Shortlist reports it, so the page can reload the dashboard", async (t) => {
  const { fetchImpl, close } = await start({
    env: { OPENAI_MODEL: "scripted", OPENAI_API_KEY: "sk-test" },
    script: [
      { toolCalls: [{ name: "update_shortlist", args: { applicantId: "A-001", status: "to_invite" } }] },
      "A-001 is on your Shortlist.",
    ],
  });
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });

  const state = await runLandlordTurn({ fetchImpl, landlordId, message: "Shortlist A-001" });

  assert.equal(state.answer, "A-001 is on your Shortlist.");
  assert.deepEqual(state.changed, { criteria: false, shortlist: true, notes: false });
});

test("a message the server rejects is an error; an unknown landlord is signed out", async (t) => {
  const { fetchImpl, close } = await start();
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });

  const rejected = await runLandlordTurn({ fetchImpl, landlordId, message: "x".repeat(4001) });
  const unknown = await runLandlordTurn({ fetchImpl, landlordId: "gone", message: "Hi" });

  assert.equal(rejected.phase, "error");
  assert.equal(rejected.error, TURN_TEXT.failed);
  assert.equal(unknown.signedOut, true);
});

test("a server that cannot be reached is a lost connection", async () => {
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  const state = await runLandlordTurn({ fetchImpl: down, landlordId: "l-1", message: "Hi" });
  assert.equal(state.phase, "error");
  assert.equal(state.error, TURN_TEXT.connectionLost);
});

test("the dashboard is fetched again only after a turn that changed the criteria or the Shortlist", () => {
  assert.equal(changedDashboard(run([{ type: "token", text: "A-007 leads." }, { type: "done" }])), false);
  assert.equal(changedDashboard(run([{ type: "criteria" }, { type: "done" }])), true);
  assert.equal(changedDashboard(run([{ type: "shortlist" }, { type: "done" }])), true);
  assert.equal(changedDashboard(run([{ type: "notes" }, { type: "done" }])), true, "a remembered preference");
  assert.equal(changedDashboard(run([{ type: "shortlist" }, { type: "error" }])), true, "saved before the turn failed");
});

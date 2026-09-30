// The landlord chat end to end on the real Tools: the server's Landlord Orchestrator with a
// scripted model, the committed Applicant pool, an in-memory store and the Berlin WFS faked.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createApp } from "../../src/app.js";
import { APPLICANT_POOL_DIRECTORY } from "../../src/landlord/applicant-pool.js";
import { createLandlordOrchestrator } from "../../src/landlord/orchestrator/index.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { ScriptedChatModel } from "../orchestrator/helpers/scripted-model.js";

const OPENAI_ENV = { OPENAI_MODEL: "scripted", OPENAI_API_KEY: "sk-test" };
const LISTING = { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 60, rooms: 2, askingRent: 900 };

// `setScript` sets the model's script once the Listing is saved, so answers can quote the real
// figures the Tools will return. `store` lets two apps share one landlord store (a server restart:
// the chat thread is gone, the store is not); `name` is the landlord who signs in.
async function start({ store = createLandlordStore({ path: ":memory:" }), name = "Erika Muster" } = {}) {
  let model;
  let script = [];
  const app = createApp({
    env: OPENAI_ENV,
    landlordStore: store,
    fetchImpl: createFakeBerlinWfs().fetchImpl,
    // The server's own Tools and context; only the model is scripted.
    createLandlordChat: ({ tools, getContext }) => {
      model = new ScriptedChatModel(script);
      return createLandlordOrchestrator({ model, tools, getContext, log: () => {} });
    },
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    return response;
  };
  const { landlordId } = (await (await request("POST", "/api/v1/landlord/sessions", { name })).json()).data;
  await request("PUT", `/api/v1/landlord/${landlordId}/listing`, LISTING);
  const dashboard = async () => (await (await request("GET", `/api/v1/landlord/${landlordId}/dashboard`)).json()).data;
  const applicant = async (applicantId) => (await (await request("GET", `/api/v1/landlord/${landlordId}/applicants/${applicantId}`)).json()).data;
  return {
    landlordId,
    dashboard,
    applicant,
    get model() {
      return model;
    },
    setScript: (entries) => {
      script = entries;
    },
    chat: async (message) => parseSse(await (await request("POST", `/api/v1/landlord/${landlordId}/chat`, { message })).text()),
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}

function parseSse(text) {
  return text
    .split("\n\n")
    .filter((block) => block.trim() && !block.startsWith(":"))
    .map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: ")).slice(6)));
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const typesOf = (events) => events.map((e) => e.type);

test("a stated preference changes the saved Selection criteria, emits criteria and the answer quotes old and new weights", async (t) => {
  const server = await start();
  t.after(server.close);
  server.setScript([
    { toolCalls: [{ name: "update_selection_criteria", args: { weights: { employment: 30, affordability: 40 } } }] },
    // 30 + 20 + 15 + 15 + 40 + 5 = 125: employment 30/125 = 24 %, affordability 40/125 = 32 %.
    "I raised employment from 15 % to 24 % and affordability from 30 % to 32 %.",
  ]);

  const events = await server.chat("Stable income matters most to me.");

  assert.deepEqual(typesOf(events), ["criteria", "token", "done"]);
  assert.equal(answerOf(events), "I raised employment from 15 % to 24 % and affordability from 30 % to 32 %.");
  assert.equal(server.model.calls.length, 2, "grounded: no rewrite");
  const { criteria, ranked } = await server.dashboard();
  assert.equal(criteria.weights.employment, 24);
  assert.equal(criteria.weights.affordability, 32);
  assert.equal(ranked[0].breakdown.employment.weight, 24);
});

test("'Only clean SCHUFA' switches on that Requirement: the dashboard excludes the others", async (t) => {
  const server = await start();
  t.after(server.close);
  server.setScript([
    { toolCalls: [{ name: "update_selection_criteria", args: { requirements: { schufaCleanOnly: true } } }] },
    "From now on only applicants with a clean SCHUFA are ranked.",
  ]);

  const events = await server.chat("Only clean SCHUFA, please.");

  assert.deepEqual(typesOf(events), ["criteria", "token", "done"]);
  const { criteria, excluded } = await server.dashboard();
  assert.equal(criteria.requirements.schufaCleanOnly, true);
  assert.ok(excluded.some(({ excludedBy }) => excludedBy === "schufaCleanOnly"));
});

test("a Shortlist request saves the entry and emits shortlist", async (t) => {
  const server = await start();
  t.after(server.close);
  const { ranked } = await server.dashboard();
  const applicantId = ranked[0].applicantId;
  server.setScript([
    { toolCalls: [{ name: "update_shortlist", args: { applicantId, status: "to_invite", note: "Stable income" } }] },
    `${applicantId} is on your Shortlist, to invite.`,
  ]);

  const events = await server.chat(`Put ${applicantId} on the shortlist to invite.`);

  assert.deepEqual(typesOf(events), ["shortlist", "token", "done"]);
  const { shortlist } = await server.dashboard();
  assert.deepEqual(
    shortlist.map(({ applicantId: id, status, note }) => ({ applicantId: id, status, note })),
    [{ applicantId, status: "to_invite", note: "Stable income" }],
  );
});

test("an unknown applicant on the Shortlist is an input error the model learns; nothing is saved, no event", async (t) => {
  const server = await start();
  t.after(server.close);
  server.setScript([
    { toolCalls: [{ name: "update_shortlist", args: { applicantId: "A-999", status: "to_invite" } }] },
    "There is no applicant A-999.",
  ]);

  const events = await server.chat("Shortlist A-999");

  assert.deepEqual(typesOf(events), ["token", "done"]);
  assert.match(server.model.calls[1].at(-1).content, /"error":"input".*A-999/);
  assert.deepEqual((await server.dashboard()).shortlist, []);
});

test("a profile question is answered with the Tool's figures; an invented figure is caught", async (t) => {
  const server = await start();
  t.after(server.close);
  const { ranked } = await server.dashboard();
  const { applicantId, matchScore } = ranked[0];
  const { profile } = await server.applicant(applicantId);
  const grounded = `${applicantId} has a net household income of ${profile.netHouseholdIncome} € and a Match score of ${matchScore}.`;
  server.setScript([
    { toolCalls: [{ name: "get_applicant_profile", args: { applicantId } }] },
    `${applicantId} earns 12345 € a month.`,
    grounded,
  ]);

  const events = await server.chat(`Tell me more about applicant ${applicantId}.`);

  assert.equal(answerOf(events), grounded);
  assert.match(server.model.calls[2][0].content, /Correction: .*12345/);
});

test("the system prompt carries the Listing, its Rent check and the pool stats every turn", async (t) => {
  const server = await start();
  t.after(server.close);
  const { stats } = await server.dashboard();
  server.setScript([`You have ${stats.total} applicants; ${stats.canAfford} can afford the rent.`]);

  const events = await server.chat("How many applicants do I have?");

  assert.equal(answerOf(events), `You have ${stats.total} applicants; ${stats.canAfford} can afford the rent.`);
  const system = server.model.calls[0][0].content;
  assert.match(system, /"askingRent":900/);
  assert.match(system, /"allowedRent":/);
  assert.match(system, new RegExp(`Applicant pool statistics:\\n\\{"total":${stats.total},`));
  assert.match(system, /whom to invite.*get_ranking.*Shortlist/);
  assert.match(system, /why one applicant ranks above another.*get_applicant_profile for both/);
});

test("a preference remembered in one conversation is in the system prompt of a new thread for the same landlord only", async (t) => {
  const store = createLandlordStore({ path: ":memory:" });
  const first = await start({ store });
  first.setScript([
    { toolCalls: [{ name: "remember_preference", args: { note: "Wants someone who stays long-term." } }] },
    "I'll remember that you want someone who stays long-term.",
  ]);
  const events = await first.chat("I'd like someone who stays long-term.");
  await first.close();
  assert.deepEqual(typesOf(events), ["notes", "token", "done"]);

  // A server restart: a new app and a new Orchestrator (so a new, empty chat thread) on the same store.
  const second = await start({ store });
  t.after(second.close);
  second.setScript(["You told me you want someone who stays long-term."]);
  await second.chat("What do you remember about me?");
  const system = second.model.calls[0][0].content;
  assert.equal(second.model.calls[0].length, 2, "a new thread: the system prompt and this message only");
  assert.match(system, /Landlord preferences remembered from earlier conversations:/);
  assert.match(system, /Wants someone who stays long-term\./);
  assert.match(system, /"weights":\{"affordability":30,/);
  assert.match(system, /do not ask the landlord to repeat them/);
  assert.deepEqual(
    (await second.dashboard()).notes.map(({ note }) => note),
    ["Wants someone who stays long-term."],
  );

  const other = await start({ store, name: "Max Mustermann" });
  t.after(other.close);
  other.setScript(["Nothing yet."]);
  await other.chat("What do you remember about me?");
  assert.doesNotMatch(other.model.calls[0][0].content, /stays long-term/);
});

// Everything in the committed pool's files that must never reach the model: names (declared and on
// the documents), contact details and the protected fields' values.
function identifyingValues() {
  const plain = new Set();
  const quoted = new Set();
  for (const file of readdirSync(APPLICANT_POOL_DIRECTORY).filter((name) => name.endsWith(".md"))) {
    const text = readFileSync(join(APPLICANT_POOL_DIRECTORY, file), "utf8");
    for (const [, field, value] of text.matchAll(/^\s*(name|email|phone|Name|dateOfBirth|photo|nationality|religion|gender|familyPlans):\s*"?([^"\n]+?)"?\s*$/gm)) {
      // Short, common words ("male", "none", "German") would also match the prompt's rules text:
      // they must not appear as a JSON value.
      if (["nationality", "religion", "gender", "familyPlans"].includes(field)) quoted.add(`"${value}"`);
      else plain.add(value);
    }
  }
  return { plain: [...plain], quoted: [...quoted] };
}

test("no applicant name, contact detail or protected field appears in any message sent to the model", async (t) => {
  const server = await start();
  t.after(server.close);
  const { ranked, excluded } = await server.dashboard();
  const ids = [...ranked, ...excluded].map(({ applicantId }) => applicantId);
  assert.equal(ids.length, 95);
  server.setScript([
    {
      toolCalls: [
        { name: "get_ranking", args: {} },
        { name: "get_rent_check", args: {} },
        { name: "update_selection_criteria", args: { weights: { employment: 30 } } },
        { name: "update_shortlist", args: { applicantId: ids[0], status: "to_invite" } },
        ...ids.map((applicantId) => ({ name: "get_applicant_profile", args: { applicantId } })),
      ],
    },
    "Done.",
    "Noted.",
  ]);

  await server.chat("Show me everything about every applicant.");
  await server.chat("Thanks.");

  const sent = JSON.stringify(server.model.calls);
  const { plain, quoted } = identifyingValues();
  assert.ok(plain.length > 100 && quoted.length > 20, "the pool's identifying values were found");
  for (const value of [...plain, ...quoted, "Erika Muster"]) assert.ok(!sent.includes(value), `${value} reached the model`);
  assert.doesNotMatch(sent, /\\"(contact|email|phone|nationality|religion|dateOfBirth|gender|photo|familyPlans)\\":/);
});

test("'Why is one applicant above another?' is answered from both profiles' breakdowns", async (t) => {
  const server = await start();
  t.after(server.close);
  const { ranked } = await server.dashboard();
  const [first, second] = [ranked[0], ranked[5]];
  const answer = `${first.applicantId} has a Match score of ${first.matchScore}, ${second.applicantId} ${second.matchScore}: affordability ${first.breakdown.affordability.subscore} against ${second.breakdown.affordability.subscore}.`;
  server.setScript([
    {
      toolCalls: [
        { name: "get_applicant_profile", args: { applicantId: first.applicantId } },
        { name: "get_applicant_profile", args: { applicantId: second.applicantId } },
      ],
    },
    answer,
  ]);

  const events = await server.chat(`Why is ${first.applicantId} above ${second.applicantId}?`);

  assert.equal(answerOf(events), answer);
  assert.equal(server.model.calls.length, 2, "grounded: no rewrite");
});

test("'Whom should I invite?' is answered from the ranking and the Shortlist", async (t) => {
  const server = await start();
  t.after(server.close);
  const { ranked } = await server.dashboard();
  const [first, second] = ranked;
  server.setScript([
    { toolCalls: [{ name: "update_shortlist", args: { applicantId: second.applicantId, status: "invited" } }] },
    `${second.applicantId} is invited.`,
    { toolCalls: [{ name: "get_ranking", args: {} }] },
    `Invite ${first.applicantId} (Match score ${first.matchScore}); ${second.applicantId} is already invited.`,
  ]);
  await server.chat(`I invited ${second.applicantId}.`);

  const events = await server.chat("Whom should I invite for a viewing?");

  assert.equal(answerOf(events), `Invite ${first.applicantId} (Match score ${first.matchScore}); ${second.applicantId} is already invited.`);
  const ranking = JSON.parse(server.model.calls.at(-1).at(-1).content);
  assert.deepEqual(ranking.shortlist, [{ applicantId: second.applicantId, status: "invited" }]);
});

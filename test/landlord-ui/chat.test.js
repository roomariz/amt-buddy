// The landlord chat panel's logic (public/landlord/chat.js): folding the SSE events into what the
// panel shows, and running a turn against the real server (in-memory store, no network).
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordOrchestrator, createLandlordStubTools } from "../../src/landlord/orchestrator/index.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { signIn } from "../../public/landlord/api.js";
import {
  applicantNames,
  changedDashboard,
  endLandlordTurn,
  initialLandlordTurn,
  reduceLandlordTurn,
  renderAnswerWithNames,
  runLandlordTurn,
  splitAnswer,
  withApplicantNames,
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
    changed: { criteria: false, shortlist: false, notes: false, flat: false },
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
  assert.deepEqual(state.changed, { criteria: true, shortlist: true, notes: false, flat: false });
  assert.equal(state.phase, "done");
});

test("a flat event marks that the flat details changed (the chat-first page redraws its ranking)", () => {
  assert.deepEqual(run([{ type: "flat" }, { type: "done" }]).changed, { criteria: false, shortlist: false, notes: false, flat: true });
  assert.equal(changedDashboard(run([{ type: "flat" }, { type: "done" }])), true);
});

test("a notes event marks that a Landlord preference was remembered", () => {
  assert.deepEqual(run([{ type: "notes" }, { type: "done" }]).changed, { criteria: false, shortlist: false, notes: true, flat: false });
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
      { toolCalls: [{ name: "update_shortlist", args: { applicantId: "A-001", status: "to_invite", note: null } }] },
      "A-001 is on your Shortlist.",
    ],
  });
  t.after(close);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });

  const state = await runLandlordTurn({ fetchImpl, landlordId, message: "Shortlist A-001" });

  assert.equal(state.answer, "A-001 is on your Shortlist.");
  assert.deepEqual(state.changed, { criteria: false, shortlist: true, notes: false, flat: false });
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

// A cancelled response shows in DevTools as a failed request (net::ERR_ABORTED): after the done
// event the rest of the response is read to its end, not cancelled, and the turn does not wait
// for the server to close it.
test("after done the turn resolves at once, ignores later events and reads the response to its end", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'event: token\ndata: {"type":"token","text":"A-007 leads."}\n\nevent: done\ndata: {"type":"done"}\n\n',
    'event: token\ndata: {"type":"token","text":" late"}\n\n',
    'event: error\ndata: {"type":"error"}\n\n',
  ];
  let close;
  const closed = new Promise((resolve) => (close = resolve));
  let pulls = 0;
  let readToEnd = false;
  let cancelled = false;
  // highWaterMark 0: pull runs only for a pending read, so the last pull proves the reader asked
  // for more after the last chunk.
  const body = new ReadableStream(
    {
      async pull(controller) {
        const index = pulls++;
        if (index === chunks.length - 1) await closed; // the server closes the response only later
        if (index < chunks.length) return controller.enqueue(encoder.encode(chunks[index]));
        controller.close();
        readToEnd = true;
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const fetchImpl = async () => new Response(body, { headers: { "content-type": "text/event-stream" } });
  const phases = [];

  let timer;
  const state = await Promise.race([
    runLandlordTurn({ fetchImpl, landlordId: "l-1", message: "Hi", onChange: (next) => phases.push(next.phase) }),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("the turn waited for the response to close")), 1000))),
  ]).finally(() => clearTimeout(timer));
  close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(state.phase, "done");
  assert.equal(state.answer, "A-007 leads.");
  assert.deepEqual(phases, ["streaming", "done"], "nothing after done reaches the panel");
  assert.equal(readToEnd, true, "the response was read to its end");
  assert.equal(cancelled, false, "the response was not cancelled");
  assert.equal(body.locked, false, "and released");
});

test("the panel shows each applicant's name next to the id the model used", () => {
  const names = applicantNames({
    ranked: [{ applicantId: "A-007", name: "Olga Rossi" }],
    excluded: [{ applicantId: "A-011", name: "Jonas Weber" }],
    shortlist: [{ applicantId: "A-020", name: "Mia Chen" }, { applicantId: "A-099", name: null }],
  });

  assert.equal(
    withApplicantNames("**A-007** ranks above A-011; A-020 and A-099 are shortlisted. A-0077 is no id we know.", names),
    "**A-007 (Olga Rossi)** ranks above A-011 (Jonas Weber); A-020 (Mia Chen) and A-099 are shortlisted. A-0077 is no id we know.",
  );
  assert.equal(withApplicantNames("A-007", applicantNames(null)), "A-007", "no dashboard yet: ids only");
});

// An applicant's name is the applicant's own text: it must never become markup. It is inserted
// after the model's Markdown is rendered, HTML-escaped, so a name written as a Markdown link or
// as HTML shows as plain text (a live link in the chat would be a phishing vector).
test("names join the rendered answer as plain text: a name is never parsed as Markdown or HTML", () => {
  const names = applicantNames({
    ranked: [
      { applicantId: "A-007", name: "[Klick hier](https://evil.example/phish) **fett**" },
      { applicantId: "A-011", name: "<img src=x onerror=alert(1)>" },
      { applicantId: "A-020", name: "Mia Chen" },
    ],
  });
  const html = renderAnswerWithNames("**A-020** leads; A-007 and A-011 follow.", names);

  assert.ok(html.includes("<strong>A-020 (Mia Chen)</strong>"), html);
  assert.ok(html.includes("A-007 ([Klick hier](https://evil.example/phish) **fett**)"), html);
  assert.ok(html.includes("A-011 (&lt;img src=x onerror=alert(1)&gt;)"), html);
  assert.ok(!html.includes("<a "), "no link from a name");
  assert.equal(html.match(/<strong>/g).length, 1, "only the model's own bold");
  assert.ok(!html.includes("<img"), "no element from a name");
});

test("the rendered answer without names is the plain Markdown rendering", () => {
  assert.ok(renderAnswerWithNames("**A-007** leads.", applicantNames(null)).includes("<strong>A-007</strong>"));
});

test("the dashboard is fetched again only after a turn that changed the criteria or the Shortlist", () => {
  assert.equal(changedDashboard(run([{ type: "token", text: "A-007 leads." }, { type: "done" }])), false);
  assert.equal(changedDashboard(run([{ type: "criteria" }, { type: "done" }])), true);
  assert.equal(changedDashboard(run([{ type: "shortlist" }, { type: "done" }])), true);
  assert.equal(changedDashboard(run([{ type: "notes" }, { type: "done" }])), true, "a remembered preference");
  assert.equal(changedDashboard(run([{ type: "shortlist" }, { type: "error" }])), true, "saved before the turn failed");
});

// After a turn that changed the ranking the model writes two parts, separated by a line that is
// only "---": the change, then the current top applicants and a next step. The page shows them as
// two messages (the user's request, round 3).
test("splitAnswer: the first line that is only --- splits the answer into two messages", () => {
  assert.deepEqual(splitAnswer("SCHUFA now counts 20 %.\n---\nYour current top applicants are: A-003 …"), [
    "SCHUFA now counts 20 %.",
    "Your current top applicants are: A-003 …",
  ]);
  assert.deepEqual(splitAnswer("One.\n\n  ---  \n\nTwo."), ["One.", "Two."], "spaces and blank lines around it");
  assert.deepEqual(splitAnswer("One.\n---\nTwo.\n---\nThree."), ["One.", "Two.\n---\nThree."], "only the first splits");
});

test("splitAnswer: no separator, one message; nothing after it, one message; not a separator inside a line", () => {
  assert.deepEqual(splitAnswer("Just one answer."), ["Just one answer.", null]);
  assert.deepEqual(splitAnswer("One.\n---\n  "), ["One.", null]);
  assert.deepEqual(splitAnswer("A range of 7.90---11.50 €"), ["A range of 7.90---11.50 €", null]);
  assert.deepEqual(splitAnswer("One.\n----\nTwo."), ["One.\n----\nTwo.", null], "four dashes are not the separator");
  assert.deepEqual(splitAnswer(""), ["", null]);
});

test("splitAnswer while streaming: a separator still being typed does not show", () => {
  // Tokens arrive in pieces; a trailing "-" or "--" line may be the start of the separator.
  assert.deepEqual(splitAnswer("One.\n--"), ["One.", null]);
  assert.deepEqual(splitAnswer("One.\n-"), ["One.", null]);
  assert.deepEqual(splitAnswer("One.\n---"), ["One.", null]);
});

// The model often writes the next-step sentence straight after a numbered list, without a blank
// line; Markdown would fold it into the last item ("… Match score 94.7 Would you like …", seen
// live). A plain line right after a list item starts a new paragraph in landlord answers.
test("a plain line right after a list is its own paragraph, not part of the last item", () => {
  const names = applicantNames(null);
  const html = renderAnswerWithNames("Here are your current top applicants:\n1. A-003 – Match score 100\n2. A-008 – Match score 96.2\n3. A-007 – Match score 94.7\nWould you like to put A-008 on your shortlist?", names);
  const list = html.slice(html.indexOf("<ol"), html.indexOf("</ol>") + 5);
  assert.ok(list.includes("A-007 – Match score 94.7"), html);
  assert.ok(!list.includes("Would you like"), `the question is outside the list: ${html}`);
  assert.ok(html.indexOf("Would you like") > html.indexOf("</ol>"), html);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
});

test("the same for a bullet list; lines without a list stay one plain paragraph", () => {
  const names = applicantNames(null);
  const bullets = renderAnswerWithNames("- one\n- two\nAfter.", names);
  assert.ok(bullets.indexOf("After.") > bullets.indexOf("</ul>"), bullets);
  const plain = renderAnswerWithNames("First line.\nSecond line.", names);
  assert.ok(!plain.includes("<ol") && !plain.includes("<ul"), plain);
});

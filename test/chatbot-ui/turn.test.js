import test from "node:test";
import assert from "node:assert/strict";

import { announcements, endTurn, initialTurn, reduceTurn, TURN_TEXT } from "../../public/chat/turn.js";

const run = (events, state = initialTurn()) => events.reduce(reduceTurn, state);

test("a new turn is streaming with nothing to show yet", () => {
  assert.deepEqual(initialTurn(), {
    phase: "streaming",
    intents: [],
    steps: [],
    answer: "",
    tenancy: null,
    review: null,
    error: null,
  });
});

test("agent steps become status chips that move from running to done", () => {
  const state = run([
    { type: "intent", intents: ["address", "mietspiegel"] },
    { type: "agent_step", agent: "OfficialDataAgent", status: "started" },
    { type: "agent_step", agent: "OfficialDataAgent", status: "finished" },
    { type: "agent_step", agent: "ComplianceAgent", status: "started" },
  ]);
  assert.deepEqual(
    state.steps.map(({ id, agent, status, label }) => ({ id, agent, status, label })),
    [
      { id: 0, agent: "OfficialDataAgent", status: "done", label: "Adresse im amtlichen Register geprüft" },
      { id: 1, agent: "ComplianceAgent", status: "running", label: "Berechne den Mietspiegel …" },
    ],
  );
});

test("a blocked check shows as needs facts next to the check that could run", () => {
  const state = run([
    { type: "intent", intents: ["mietspiegel", "occupancy"] },
    { type: "agent_step", agent: "ComplianceAgent", status: "needs_facts" },
    { type: "agent_step", agent: "ComplianceAgent", status: "started" },
    { type: "agent_step", agent: "ComplianceAgent", status: "finished" },
  ]);
  assert.deepEqual(
    state.steps.map(({ status, label }) => ({ status, label })),
    [
      { status: "needs_facts", label: "Für die Prüfung fehlen noch Angaben" },
      { status: "done", label: "Mögliche Prüfung abgeschlossen" },
    ],
    "only one of the two checks ran, so the chip does not claim both",
  );
});

test("a failed Sub-agent and an occupancy-only check get their own wording", () => {
  const state = run([
    { type: "intent", intents: ["occupancy"] },
    { type: "agent_step", agent: "OfficialDataAgent", status: "started" },
    { type: "agent_step", agent: "OfficialDataAgent", status: "failed" },
    { type: "agent_step", agent: "ComplianceAgent", status: "started" },
    { type: "agent_step", agent: "LeaseAnalysisAgent", status: "started" },
  ]);
  assert.deepEqual(
    state.steps.map((step) => step.label),
    [
      "Der amtliche Berliner Dienst antwortet gerade nicht",
      "Prüfe die Belegung (§ 7 WoAufG Bln) …",
      "Lese Ihren Mietvertrag …",
    ],
  );
});

test("the answer is the token text and done ends the turn", () => {
  const state = run([
    { type: "token", text: "**Ergebnis**" },
    { type: "done" },
  ]);
  assert.equal(state.answer, "**Ergebnis**");
  assert.equal(state.phase, "done");
});

test("a tenancy with an Unconfirmed lease value opens the review card; a later confirmed one closes it", () => {
  const unconfirmed = { contractRent: { value: 780, source: "lease", confidence: 0.6 } };
  let state = run([{ type: "tenancy", tenancy: unconfirmed }]);
  assert.deepEqual(state.tenancy, unconfirmed);
  assert.equal(state.review.fields[0].name, "contractRent");

  state = reduceTurn(state, { type: "tenancy", tenancy: { contractRent: { value: 780, source: "user" } } });
  assert.equal(state.review, null);
});

test("an error event ends the turn with a friendly text, not the technical message", () => {
  const state = run([
    { type: "agent_step", agent: "ComplianceAgent", status: "started" },
    { type: "error", message: "GraphRecursionError: Recursion limit of 40 reached" },
  ]);
  assert.equal(state.phase, "error");
  assert.equal(state.error, TURN_TEXT.failed);
  assert.doesNotMatch(state.error, /Recursion/);
  assert.equal(state.steps[0].status, "failed");
});

test("events after the terminal event are ignored", () => {
  const state = run([{ type: "done" }, { type: "token", text: "late" }, { type: "error", message: "x" }]);
  assert.equal(state.phase, "done");
  assert.equal(state.answer, "");
});

test("a stream that ends without done or error is a lost connection", () => {
  const state = endTurn(run([{ type: "agent_step", agent: "OfficialDataAgent", status: "started" }]));
  assert.equal(state.phase, "error");
  assert.equal(state.error, TURN_TEXT.connectionLost);
  assert.equal(endTurn(run([{ type: "done" }])).phase, "done");
});

test("announcements name the steps that changed and the end of the turn", () => {
  const before = run([{ type: "agent_step", agent: "OfficialDataAgent", status: "started" }]);
  const after = reduceTurn(before, { type: "agent_step", agent: "OfficialDataAgent", status: "finished" });
  assert.deepEqual(announcements(initialTurn(), before), ["Prüfe das amtliche Berliner Adressregister …"]);
  assert.deepEqual(announcements(before, after), ["Adresse im amtlichen Register geprüft"]);
  assert.deepEqual(announcements(after, reduceTurn(after, { type: "done" })), ["Antwort ist da."]);
  assert.deepEqual(announcements(after, reduceTurn(after, { type: "error", message: "x" })), [TURN_TEXT.failed]);
});

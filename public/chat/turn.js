// One chat turn as a view model: the Orchestrator's events (docs/orchestrator.md, "HTTP and SSE
// interface") folded into what the page shows. Pure: reduceTurn(state, event) → new state.

import { t } from "../i18n.js";
import { reviewCard } from "./tenancy.js";

// The turn's own texts in the current UI language. Getters: read when a turn uses them, so a
// switch applies to new text while text already shown stays.
export const TURN_TEXT = {
  get failed() {
    return t("turn.failed");
  },
  get connectionLost() {
    return t("turn.connectionLost");
  },
  get done() {
    return t("turn.done");
  },
};

// Sub-agent step wording per status. Compliance names the check the message asked for; when
// both were asked for but one is blocked (needs_facts), the events do not say which one runs.
function complianceCheck(intents, blocked) {
  const mietspiegel = intents.includes("mietspiegel");
  const occupancy = intents.includes("occupancy");
  if (occupancy && mietspiegel) return blocked ? "remaining" : "both";
  return occupancy ? "occupancy" : "mietspiegel";
}

// Sub-agents with their own wording (i18n.js, "steps"); any other agent gets "steps.other".
const NAMED_AGENTS = ["OfficialDataAgent", "ComplianceAgent", "LeaseAnalysisAgent"];

function stepLabel(agent, status, intents, blocked = false) {
  const group = NAMED_AGENTS.includes(agent) ? agent : "other";
  // Compliance's running and done wording names the check.
  const perCheck = group === "ComplianceAgent" && (status === "running" || status === "done");
  return t(`steps.${group}.${status}${perCheck ? `.${complianceCheck(intents, blocked)}` : ""}`);
}

// Event statuses → chip statuses.
const STEP_STATUS = { started: "running", finished: "done", failed: "failed", needs_facts: "needs_facts" };

export function initialTurn() {
  return { phase: "streaming", intents: [], steps: [], answer: "", tenancy: null, review: null, error: null };
}

function withStep(state, agent, status) {
  const steps = state.steps.map((step) => ({ ...step }));
  // finished / failed close this agent's running step; started and needs_facts add a chip.
  const running =
    status === "done" || status === "failed"
      ? steps.findLast((step) => step.agent === agent && step.status === "running")
      : undefined;
  const step = running ?? { id: steps.length, agent };
  if (!running) steps.push(step);
  step.status = status;
  const blocked = steps.some((s) => s.agent === agent && s.status === "needs_facts");
  step.label = stepLabel(agent, status, state.intents, blocked);
  return { ...state, steps };
}

// Running chips of a turn that ended in an error did not finish.
const failRunning = (steps) =>
  steps.map((step) =>
    step.status === "running" ? { ...step, status: "failed", label: stepLabel(step.agent, "failed", []) } : step,
  );

export function reduceTurn(state, event) {
  if (state.phase !== "streaming" || !event || typeof event.type !== "string") return state;
  switch (event.type) {
    case "intent":
      return { ...state, intents: Array.isArray(event.intents) ? event.intents : [] };
    case "agent_step": {
      const status = STEP_STATUS[event.status];
      return status ? withStep(state, String(event.agent ?? ""), status) : state;
    }
    case "tenancy":
      return { ...state, tenancy: event.tenancy ?? null, review: reviewCard(event.tenancy) };
    case "token":
      return { ...state, answer: state.answer + (typeof event.text === "string" ? event.text : "") };
    case "done":
      return { ...state, phase: "done" };
    case "error":
      // The event's message is technical (docs/orchestrator.md): show our own text.
      return { ...state, phase: "error", error: TURN_TEXT.failed, steps: failRunning(state.steps) };
    default:
      return state;
  }
}

// The response ended (or the connection broke). Without a terminal event, the turn failed.
export function endTurn(state) {
  if (state.phase !== "streaming") return state;
  return { ...state, phase: "error", error: TURN_TEXT.connectionLost, steps: failRunning(state.steps) };
}

// What the aria-live region should read out after an event: changed step labels, then the end.
export function announcements(before, after) {
  const said = [];
  for (const step of after.steps) {
    const previous = before.steps.find((s) => s.id === step.id);
    if (!previous || previous.label !== step.label) said.push(step.label);
  }
  if (before.phase === "streaming" && after.phase === "done") said.push(TURN_TEXT.done);
  if (before.phase === "streaming" && after.phase === "error") said.push(after.error);
  return said;
}

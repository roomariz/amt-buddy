// One chat turn as a view model: the Orchestrator's events (docs/orchestrator.md, "HTTP and SSE
// interface") folded into what the page shows. Pure: reduceTurn(state, event) → new state.

import { reviewCard } from "./tenancy.js";

export const TURN_TEXT = {
  failed: "Amt-Buddy konnte diese Nachricht gerade nicht beantworten. Bitte versuchen Sie es gleich noch einmal.",
  connectionLost: "Die Verbindung zu Amt-Buddy wurde unterbrochen. Bitte senden Sie Ihre Nachricht noch einmal.",
  done: "Antwort ist da.",
};

// Sub-agent step wording per status. Compliance names the check the message asked for; when
// both were asked for but one is blocked (needs_facts), the events do not say which one runs.
function complianceCheck(intents, blocked) {
  const mietspiegel = intents.includes("mietspiegel");
  const occupancy = intents.includes("occupancy");
  if (occupancy && mietspiegel) return blocked ? "remaining" : "both";
  return occupancy ? "occupancy" : "mietspiegel";
}

const STEP_LABELS = {
  OfficialDataAgent: {
    running: "Prüfe das amtliche Berliner Adressregister …",
    done: "Adresse im amtlichen Register geprüft",
    failed: "Der amtliche Berliner Dienst antwortet gerade nicht",
    needs_facts: "Für die Adressprüfung fehlen noch Angaben",
  },
  ComplianceAgent: {
    running: {
      mietspiegel: "Berechne den Mietspiegel …",
      occupancy: "Prüfe die Belegung (§ 7 WoAufG Bln) …",
      both: "Prüfe Mietspiegel und Belegung …",
      remaining: "Führe die mögliche Prüfung durch …",
    },
    done: {
      mietspiegel: "Mietspiegel berechnet",
      occupancy: "Belegung geprüft",
      both: "Mietspiegel und Belegung geprüft",
      remaining: "Mögliche Prüfung abgeschlossen",
    },
    failed: "Die Prüfung konnte nicht abgeschlossen werden",
    needs_facts: "Für die Prüfung fehlen noch Angaben",
  },
  LeaseAnalysisAgent: {
    running: "Lese Ihren Mietvertrag …",
    done: "Mietvertrag gelesen",
    failed: "Der Mietvertrag konnte nicht gelesen werden",
    needs_facts: "Bitte laden Sie Ihren Mietvertrag hoch",
  },
};

const OTHER_STEP = {
  running: "Arbeite an Ihrer Anfrage …",
  done: "Schritt erledigt",
  failed: "Ein Schritt ist fehlgeschlagen",
  needs_facts: "Es fehlen noch Angaben",
};

function stepLabel(agent, status, intents, blocked = false) {
  const label = (STEP_LABELS[agent] ?? OTHER_STEP)[status];
  return typeof label === "string" ? label : label[complianceCheck(intents, blocked)];
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

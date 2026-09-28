import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, getWriter, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import { factsFromEvidence, hasComplianceVerdict } from "./evidence.js";
import { intentSchema, normalizeIntents, routerMessages } from "./intents.js";
import { reply } from "./replies.js";
import { blockingFacts } from "./requirements.js";
import { pinnedArgs, runSubAgent, SUB_AGENTS, subAgentTask, toolRefusal } from "./sub-agents.js";
import { AGENT_FOR_TOOL, SUPERVISOR_TOOLS, supervisorSystemMessage } from "./supervisor.js";
import { confirmedValues, mergeTenancy, tenancyReducer } from "./tenancy.js";
import { wrapTool } from "./tool-wrapper.js";

// A channel whose latest write wins.
const lastValue = (fallback) => Annotation({ reducer: (_, update) => update, default: fallback });

export const OrchestratorState = Annotation.Root({
  ...MessagesAnnotation.spec,
  // The Tenancy of the conversation; updates are Tenancy fact updates, `null` resets it.
  tenancy: Annotation({ reducer: tenancyReducer, default: () => ({}) }),
  // Evidence of the current turn: one entry per Tool call; `null` resets it.
  evidence: Annotation({ reducer: (current, update) => (update === null ? [] : current.concat(update)), default: () => [] }),
  intents: lastValue(() => []),
  language: lastValue(() => "en"),
  documentId: lastValue(() => null),
  disclaimerShown: lastValue(() => false),
  // Per-turn input and scratch values, reset by `ingest`.
  confirm: lastValue(() => null),
  skipRouter: lastValue(() => false),
  draft: lastValue(() => ""),
});

function emit(event) {
  try {
    getWriter()?.(event);
  } catch {
    // Not running under stream(): nothing to emit to.
  }
}

function textOf(message) {
  return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

export function buildGraph({ models, tools, log, toolTimeoutMs }) {
  async function ingest(state) {
    const update = { evidence: null, intents: [], draft: "", confirm: null };
    if (state.confirm && state.skipRouter) {
      update.messages = [new HumanMessage(`[Confirmed Tenancy facts] ${JSON.stringify(state.confirm)}`)];
    }
    return update;
  }

  async function classifyIntent(state) {
    const result = await models.router.withStructuredOutput(intentSchema).invoke(routerMessages(state.messages));
    const intents = normalizeIntents(result.intents);
    emit({ type: "intent", intents });
    return { intents, language: result.language || state.language };
  }

  async function rejectOutOfScope(state) {
    const text = reply("outOfScope", state.language);
    emit({ type: "token", text });
    return { messages: [new AIMessage(text)] };
  }

  async function supervisor(state, config) {
    const system = supervisorSystemMessage(state);
    const response = await models.supervisor.bindTools(SUPERVISOR_TOOLS).invoke([system, ...state.messages], config);
    if (response.tool_calls?.length) return { messages: [response], draft: "" };
    return { draft: textOf(response).trim() || reply("fallback", state.language) };
  }

  // Runs one (already gated) Sub-agent over its wrapped Tools. Returns its report for
  // the Supervisor, the Tenancy fact updates its Tool results imply, and its evidence.
  async function delegateToSubAgent(agent, args, tenancy, threadId) {
    const label = SUB_AGENTS[agent].label;
    emit({ type: "agent_step", agent: label, status: "started" });
    const evidence = [];
    let current = tenancy;
    const baseTools = SUB_AGENTS[agent].tools.map((name) => tools.get(name));
    const agentTools = baseTools.map((baseTool) =>
      wrapTool(baseTool, {
        agent,
        threadId,
        timeoutMs: toolTimeoutMs,
        log,
        onEvidence: (entry) => {
          evidence.push(entry);
          current = mergeTenancy(current, factsFromEvidence([entry]));
        },
        // Resolved per call, so a Tool sees facts an earlier Tool of this run produced.
        pinnedArgs: () => pinnedArgs(baseTool.name, confirmedValues(current)),
        guard: () => toolRefusal(baseTool.name, confirmedValues(current), args.checks),
      }),
    );
    let summary;
    try {
      summary = await runSubAgent({
        agent,
        model: models.subAgent,
        schemas: baseTools,
        tools: agentTools,
        task: subAgentTask({ args, facts: confirmedValues(tenancy) }),
      });
    } catch (error) {
      emit({ type: "agent_step", agent: label, status: "failed" });
      throw error;
    }
    // Failed: nothing succeeded because an official service is down. Input errors
    // (a malformed address) are reported as results, so the user is asked to fix them.
    const failed =
      evidence.some((entry) => entry.error?.kind === "upstream") && evidence.every((entry) => entry.error);
    emit({ type: "agent_step", agent: label, status: failed ? "failed" : "finished" });
    const report = {
      status: failed ? "failed" : "done",
      summary,
      results: evidence.map(({ tool, result, error }) => (error ? { tool, error } : { tool, result })),
    };
    return { report, updates: factsFromEvidence(evidence), evidence };
  }

  // Executes the Supervisor's tool calls in order, so a later Sub-agent sees the
  // facts an earlier one produced. Lease Analysis is not wired in yet and answers "unavailable".
  async function delegate(state, config) {
    const threadId = config?.configurable?.thread_id;
    const call = state.messages.at(-1);
    let tenancy = state.tenancy;
    const tenancyUpdates = [];
    const turnEvidence = [];
    const messages = [];

    for (const toolCall of call.tool_calls) {
      let report;
      let updates = [];
      const agent = AGENT_FOR_TOOL[toolCall.name];
      if (toolCall.name === "record_tenancy_facts") {
        updates = (toolCall.args.facts ?? []).map(({ fact, value }) => ({ fact, value, source: "user" }));
        report = { status: "recorded" };
      } else if (SUB_AGENTS[agent]) {
        // Gating in code: a Sub-agent without its required facts does not run.
        const { blocked, missing, unconfirmed } = blockingFacts(agent, toolCall.args ?? {}, tenancy);
        if (blocked) {
          emit({ type: "agent_step", agent: SUB_AGENTS[agent].label, status: "needs_facts" });
          report = { status: "needs_facts", missing, unconfirmed };
        } else {
          let evidence;
          ({ report, updates, evidence } = await delegateToSubAgent(agent, toolCall.args, tenancy, threadId));
          turnEvidence.push(...evidence);
        }
      } else {
        report = { status: "unavailable", agent: agent ?? null, message: "This Sub-agent is not available yet; answer without it." };
      }
      tenancy = mergeTenancy(tenancy, updates);
      tenancyUpdates.push(...updates);
      messages.push(new ToolMessage({ tool_call_id: toolCall.id, name: toolCall.name, content: JSON.stringify(report) }));
    }

    if (JSON.stringify(tenancy) !== JSON.stringify(state.tenancy)) emit({ type: "tenancy", tenancy });
    return { messages, tenancy: tenancyUpdates, evidence: turnEvidence };
  }

  // The disclaimer is appended by code: to every answer with a Compliance verdict,
  // and otherwise at most once per conversation.
  async function finalize(state) {
    const needsDisclaimer = hasComplianceVerdict(state.evidence) || !state.disclaimerShown;
    const text = needsDisclaimer ? `${state.draft}\n\n${reply("disclaimer", state.language)}` : state.draft;
    emit({ type: "token", text });
    return { messages: [new AIMessage(text)], disclaimerShown: state.disclaimerShown || needsDisclaimer, draft: "" };
  }

  return new StateGraph(OrchestratorState)
    .addNode("ingest", ingest)
    .addNode("classifyIntent", classifyIntent)
    .addNode("rejectOutOfScope", rejectOutOfScope)
    .addNode("supervisor", supervisor)
    .addNode("delegate", delegate)
    .addNode("finalize", finalize)
    .addEdge(START, "ingest")
    .addConditionalEdges("ingest", (state) => (state.skipRouter ? "supervisor" : "classifyIntent"), [
      "supervisor",
      "classifyIntent",
    ])
    .addConditionalEdges(
      "classifyIntent",
      (state) => (state.intents.includes("out_of_scope") ? "rejectOutOfScope" : "supervisor"),
      ["rejectOutOfScope", "supervisor"],
    )
    .addEdge("rejectOutOfScope", END)
    .addConditionalEdges("supervisor", (state) => (state.draft ? "finalize" : "delegate"), ["finalize", "delegate"])
    .addEdge("delegate", "supervisor")
    .addEdge("finalize", END);
}

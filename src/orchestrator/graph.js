import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, getWriter, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import { intentSchema, normalizeIntents, routerMessages } from "./intents.js";
import { reply } from "./replies.js";
import { AGENT_FOR_TOOL, SUPERVISOR_TOOLS, supervisorSystemMessage } from "./supervisor.js";

// A channel whose latest write wins.
const lastValue = (fallback) => Annotation({ reducer: (_, update) => update, default: fallback });

export const OrchestratorState = Annotation.Root({
  ...MessagesAnnotation.spec,
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

export function buildGraph({ models }) {
  async function ingest(state) {
    const update = { intents: [], draft: "", confirm: null };
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

  // Walking skeleton: Sub-agents are not wired in yet, so every delegation is
  // answered with an "unavailable" report and the Supervisor answers directly.
  async function delegate(state) {
    const call = state.messages.at(-1);
    const messages = call.tool_calls.map(
      (toolCall) =>
        new ToolMessage({
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify({
            status: "unavailable",
            agent: AGENT_FOR_TOOL[toolCall.name] ?? null,
            message: "This Sub-agent is not available yet; answer without it.",
          }),
        }),
    );
    return { messages };
  }

  // The disclaimer is appended by code, at most once per conversation.
  async function finalize(state) {
    const needsDisclaimer = !state.disclaimerShown;
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

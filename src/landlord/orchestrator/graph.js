import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, getWriter, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import { errorKind } from "../../orchestrator/tool-wrapper.js";
import { checkLandlordAnswer, stripUngroundedFigures } from "./grounding.js";
import { landlordSystemMessage } from "./prompt.js";
import { detectLanguage, landlordReply } from "./replies.js";

// A channel whose latest write wins.
const lastValue = (fallback) => Annotation({ reducer: (_, update) => update, default: fallback });

export const LandlordState = Annotation.Root({
  ...MessagesAnnotation.spec,
  // Per-turn values, set or reset by `ingest`.
  landlordId: lastValue(() => null),
  // What the system prompt shows of the landlord's state: { listing, preferences, stats }.
  context: lastValue(() => ({})),
  // Evidence of the current turn, one entry per Tool call; `null` resets it.
  evidence: Annotation({ reducer: (current, update) => (update === null ? [] : current.concat(update)), default: () => [] }),
  draft: lastValue(() => ""),
  // The landlord's language ("de" / "en"): that of their latest message that gives a clue.
  language: lastValue(() => "de"),
  // The text the landlord sent this turn: its numbers count as grounded.
  userText: lastValue(() => ""),
  // Grounding rewrites made this turn, and the figures the last draft could not ground.
  groundingRewrites: lastValue(() => 0),
  ungroundedFigures: lastValue(() => []),
});

// The agent rewrites an ungrounded draft at most this many times.
const MAX_GROUNDING_REWRITES = 1;

// Tool results that change what the landlord page shows → the event that tells it.
const CHANGE_EVENTS = { update_selection_criteria: "criteria", update_shortlist: "shortlist" };

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

function withTimeout(promise, timeoutMs, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} did not respond within ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ingest → agent ⇄ tools → verifyGrounding → finalize: one agent, no Intent router, no Sub-agents.
// - tools: Map name → LangChain tool; each is invoked with config.configurable.landlordId.
// - getContext(landlordId): the landlord's state for the system prompt, loaded every turn.
export function buildLandlordGraph({ model, tools, getContext, log, toolTimeoutMs }) {
  const boundModel = model.bindTools([...tools.values()]);

  async function ingest(state) {
    const userText = textOf(state.messages.at(-1));
    return {
      evidence: null,
      draft: "",
      groundingRewrites: 0,
      ungroundedFigures: [],
      userText,
      language: detectLanguage(userText) ?? state.language,
      context: (await getContext(state.landlordId)) ?? {},
    };
  }

  async function agent(state, config) {
    const system = landlordSystemMessage(state);
    const response = await boundModel.invoke([system, ...state.messages], config);
    if (response.tool_calls?.length) return { messages: [response], draft: "" };
    return { draft: textOf(response).trim() || landlordReply("fallback", state.language) };
  }

  // Runs one Tool call → { message, evidence }. Errors go back to the model as the result.
  // Not the tenant's wrapTool: that one cannot pass the landlord in the call's config, and the
  // landlord Tools are local (no upstream service), so there is no retry.
  async function runTool(toolCall, landlordId) {
    const baseTool = tools.get(toolCall.name);
    const args = toolCall.args ?? {};
    const startedAt = Date.now();
    let outcome;
    if (!baseTool) {
      outcome = { error: { kind: "input", message: `There is no tool named ${toolCall.name}.` } };
    } else {
      try {
        const result = await withTimeout(
          Promise.resolve(baseTool.invoke(args, { configurable: { landlordId } })),
          toolTimeoutMs,
          toolCall.name,
        );
        outcome = { result };
      } catch (error) {
        outcome = { error: { kind: errorKind(error), message: error?.message ?? String(error) } };
      }
    }
    // PII-free: argument names, never values.
    log({
      event: "tool_call",
      landlordId,
      tool: toolCall.name,
      argKeys: Object.keys(args),
      latencyMs: Date.now() - startedAt,
      outcome: outcome.error ? "error" : "ok",
      ...(outcome.error && { errorKind: outcome.error.kind }),
    });
    const content = JSON.stringify(outcome.error ? { error: outcome.error.kind, message: outcome.error.message } : outcome.result);
    return {
      message: new ToolMessage({ tool_call_id: toolCall.id, name: toolCall.name, content }),
      evidence: { tool: toolCall.name, args, ...outcome },
    };
  }

  async function runTools(state) {
    const messages = [];
    const evidence = [];
    for (const toolCall of state.messages.at(-1).tool_calls) {
      const ran = await runTool(toolCall, state.landlordId);
      messages.push(ran.message);
      evidence.push(ran.evidence);
      if (ran.evidence.result && CHANGE_EVENTS[toolCall.name]) emit({ type: CHANGE_EVENTS[toolCall.name] });
    }
    return { messages, evidence };
  }

  // Every number in the draft must be grounded. An ungrounded draft goes back to the agent once
  // with a correction note naming the figures; if the rewrite still fails, its sentences with
  // ungrounded figures are removed, and if nothing is left the fallback question replaces it.
  async function verifyGrounding(state) {
    const { grounded, ungrounded } = checkLandlordAnswer(state.draft, state);
    if (grounded) return {};
    // An empty draft sends the turn back to the agent.
    if (state.groundingRewrites < MAX_GROUNDING_REWRITES) {
      return { draft: "", groundingRewrites: state.groundingRewrites + 1, ungroundedFigures: ungrounded };
    }
    const stripped = stripUngroundedFigures(state.draft, ungrounded);
    const draft = stripped
      ? `${stripped}\n\n${landlordReply("removedFigures", state.language)}`
      : landlordReply("fallback", state.language);
    return { draft };
  }

  async function finalize(state) {
    emit({ type: "token", text: state.draft });
    return { messages: [new AIMessage(state.draft)], draft: "" };
  }

  return new StateGraph(LandlordState)
    .addNode("ingest", ingest)
    .addNode("agent", agent)
    .addNode("tools", runTools)
    .addNode("verifyGrounding", verifyGrounding)
    .addNode("finalize", finalize)
    .addEdge(START, "ingest")
    .addEdge("ingest", "agent")
    .addConditionalEdges("agent", (state) => (state.draft ? "verifyGrounding" : "tools"), ["verifyGrounding", "tools"])
    .addEdge("tools", "agent")
    .addConditionalEdges("verifyGrounding", (state) => (state.draft ? "finalize" : "agent"), ["agent", "finalize"])
    .addEdge("finalize", END);
}

import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createEventTranslator } from "../../orchestrator/events.js";
import { DEFAULT_TOOL_TIMEOUT_MS, defaultAuditLog } from "../../orchestrator/tool-wrapper.js";
import { buildLandlordGraph } from "./graph.js";
import { assertLandlordToolsMatchContracts } from "./tool-contracts.js";

export { LANDLORD_TOOL_CONTRACTS, LANDLORD_TOOL_NAMES } from "./tool-contracts.js";
export { createLandlordStubTools } from "./stub-tools.js";
export { createLandlordContext, createLandlordTools } from "./landlord-tools.js";

const RECURSION_LIMIT = 25;

// The Landlord Orchestrator: a LangGraph graph of its own, separate from the tenant Orchestrator.
// - model: a chat model supporting bindTools.
// - tools: LangChain tools implementing every contract in LANDLORD_TOOL_CONTRACTS; each call gets
//   the landlord as config.configurable.landlordId.
// - getContext(landlordId): the landlord's state the system prompt shows every turn
//   ({ listing?, preferences?, stats? }); its figures count as grounded.
// - checkpointer: the conversation memory, one thread per landlord (default: in memory).
// - log: receives one PII-free audit entry per Tool call (default: JSON lines on stdout).
export function createLandlordOrchestrator({
  model,
  tools,
  getContext = async () => ({}),
  checkpointer = new MemorySaver(),
  log = defaultAuditLog,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
}) {
  const toolsByName = assertLandlordToolsMatchContracts(tools);
  const graph = buildLandlordGraph({ model, tools: toolsByName, getContext, log, toolTimeoutMs }).compile({ checkpointer });

  // One landlord turn. Yields { type: "token", text } | { type: "criteria" } | { type: "shortlist" }
  // | { type: "done" } | { type: "error", message }; exactly one terminal event (done or error)
  // ends every turn. `signal` (an AbortSignal) cancels the run; the turn then ends with `error`.
  async function* send({ landlordId, message, signal } = {}) {
    if (!landlordId) throw new TypeError("send() requires a landlordId");
    const text = message?.trim() ?? "";
    if (!text) throw new TypeError("send() requires a message");

    const translate = createEventTranslator();
    try {
      const stream = await graph.stream(
        { messages: [new HumanMessage(text)], landlordId },
        { configurable: { thread_id: landlordId }, streamMode: ["custom"], recursionLimit: RECURSION_LIMIT, signal },
      );
      for await (const [mode, chunk] of stream) yield* translate(mode, chunk);
      yield { type: "done" };
    } catch (error) {
      yield { type: "error", message: error?.message ?? String(error) };
    }
  }

  return { send };
}

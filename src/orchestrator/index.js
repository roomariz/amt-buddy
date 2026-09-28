import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createEventTranslator } from "./events.js";
import { buildGraph } from "./graph.js";
import { assertToolsMatchContracts } from "./tool-contracts.js";

export { TOOL_CONTRACTS, TOOL_NAMES } from "./tool-contracts.js";
export { createStubTools } from "./stub-tools.js";

const RECURSION_LIMIT = 40;
const DOCUMENT_ONLY_MESSAGE = "[The user uploaded a lease document]";

// models: { router, supervisor, subAgent } chat models supporting bindTools / withStructuredOutput.
// tools: LangChain tools implementing every contract in TOOL_CONTRACTS.
export function createOrchestrator({ models, tools, checkpointer = new MemorySaver() }) {
  const toolsByName = assertToolsMatchContracts(tools);
  const graph = buildGraph({ models, tools: toolsByName }).compile({ checkpointer });

  // One user turn. Yields domain events:
  // { type: "intent", intents } | { type: "token", text } | { type: "done" } | { type: "error", message }
  // Exactly one terminal event (done or error) ends every turn.
  async function* send({ threadId, message, documentId, confirm } = {}) {
    if (!threadId) throw new TypeError("send() requires a threadId");
    const text = message?.trim() || (documentId ? DOCUMENT_ONLY_MESSAGE : "");
    if (!text && !confirm) throw new TypeError("send() requires a message, a documentId or confirm");

    const input = {
      messages: text ? [new HumanMessage(text)] : [],
      confirm: confirm ?? null,
      skipRouter: !text,
    };
    if (documentId) input.documentId = documentId;

    const translate = createEventTranslator();
    try {
      const stream = await graph.stream(input, {
        configurable: { thread_id: threadId },
        streamMode: ["custom", "values"],
        recursionLimit: RECURSION_LIMIT,
      });
      for await (const [mode, chunk] of stream) {
        yield* translate(mode, chunk);
      }
      yield { type: "done" };
    } catch (error) {
      yield { type: "error", message: error?.message ?? String(error) };
    }
  }

  async function getTenancy(threadId) {
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    return snapshot.values?.tenancy ?? {};
  }

  return { send, getTenancy };
}

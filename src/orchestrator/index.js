import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createEventTranslator } from "./events.js";
import { buildGraph } from "./graph.js";
import { assertToolsMatchContracts } from "./tool-contracts.js";
import { DEFAULT_TOOL_TIMEOUT_MS, defaultAuditLog } from "./tool-wrapper.js";

export { TOOL_CONTRACTS, TOOL_NAMES } from "./tool-contracts.js";
export { createStubTools } from "./stub-tools.js";
export { createBerlinTools } from "./berlin-tools.js";

const RECURSION_LIMIT = 40;
const DOCUMENT_ONLY_MESSAGE = "[The user uploaded a lease document]";

// models: { router, supervisor, subAgent } chat models supporting bindTools / withStructuredOutput.
// tools: LangChain tools implementing every contract in TOOL_CONTRACTS.
// log: receives one PII-free audit entry per Tool call (default: JSON lines on stdout).
// toolTimeoutMs: per-attempt Tool timeout.
export function createOrchestrator({
  models,
  tools,
  checkpointer = new MemorySaver(),
  log = defaultAuditLog,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
}) {
  const toolsByName = assertToolsMatchContracts(tools);
  const graph = buildGraph({ models, tools: toolsByName, log, toolTimeoutMs }).compile({ checkpointer });

  // One user turn. Yields domain events:
  // { type: "intent", intents } | { type: "agent_step", agent, status } | { type: "tenancy", tenancy }
  // | { type: "token", text } | { type: "done" } | { type: "error", message }
  // Exactly one terminal event (done or error) ends every turn.
  // `signal` (an AbortSignal) cancels the run, e.g. when the client disconnects; the turn then ends with `error`.
  async function* send({ threadId, message, documentId, confirm, signal } = {}) {
    if (!threadId) throw new TypeError("send() requires a threadId");
    const typed = message?.trim() ?? "";
    const text = typed || (documentId ? DOCUMENT_ONLY_MESSAGE : "");
    if (!text && !confirm) throw new TypeError("send() requires a message, a documentId or confirm");

    const confirmed = confirm ?? null;
    const input = {
      messages: text ? [new HumanMessage(text)] : [],
      confirm: confirmed,
      skipRouter: !text,
      newDocument: Boolean(documentId),
      // The Transcript's user entry: the text as typed (never the internal markers), whether a
      // lease came with it, and the confirmed values as sent.
      transcript: [{ role: "user", text: typed, document: Boolean(documentId), confirm: confirmed }],
    };
    if (documentId) input.documentId = documentId;

    const translate = createEventTranslator();
    try {
      const stream = await graph.stream(input, {
        configurable: { thread_id: threadId },
        streamMode: ["custom"],
        recursionLimit: RECURSION_LIMIT,
        signal,
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
    return (await getThread(threadId)).tenancy;
  }

  // What the thread shows the user: its Transcript and Tenancy (both empty for an unknown thread).
  // Read-only: calls no model.
  async function getThread(threadId) {
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    return { transcript: snapshot.values?.transcript ?? [], tenancy: snapshot.values?.tenancy ?? {} };
  }

  return { send, getTenancy, getThread };
}

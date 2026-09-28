import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";

const SHARED_RULES = `Call your tools with values taken exactly from the Tenancy facts given to you; never invent or guess a value.
If a tool returns an error, do not retry it yourself; report the error.
Finish with a short factual summary of what the tools returned, in English, without advice.`;

// Sub-agents the delegate node can run. Compliance and Lease Analysis join here
// when their slices land.
export const SUB_AGENTS = {
  official_data: {
    label: "OfficialDataAgent",
    tools: ["validate_berlin_address", "lookup_building_age"],
    prompt: `You are the Official Data agent of Amt-Buddy. You verify Berlin addresses against the official register.
After a successful address verification, always look up the building age with the returned coordinates.
${SHARED_RULES}`,
  },
};

// Tool arguments that must equal a Tenancy fact: tool → { argument: fact }.
const TOOL_ARG_FACTS = {
  validate_berlin_address: { address: "address" },
};

// Arguments pinned to confirmed Tenancy values, so a Sub-agent model cannot
// pass a Tool a value that differs from the Tenancy.
// lookup_building_age is pinned only once official coordinates exist; within the
// Official Data run they come from the verification that just happened.
export function pinnedArgs(toolName, facts) {
  if (toolName === "lookup_building_age") return facts.coordinates ?? {};
  return Object.fromEntries(
    Object.entries(TOOL_ARG_FACTS[toolName] ?? {})
      .filter(([, fact]) => facts[fact] !== undefined)
      .map(([arg, fact]) => [arg, facts[fact]]),
  );
}

const MAX_SUB_AGENT_STEPS = 12;

// Runs one Sub-agent as a small ReAct loop over its (already wrapped) Tools and
// returns its final summary text.
export async function runSubAgent({ agent, model, tools, task }) {
  const bound = model.bindTools(tools);
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({ messages: [await bound.invoke(state.messages)] }))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition, ["tools", END])
    .addEdge("tools", "agent")
    .compile();

  const result = await graph.invoke(
    { messages: [new SystemMessage(SUB_AGENTS[agent].prompt), new HumanMessage(task)] },
    { recursionLimit: MAX_SUB_AGENT_STEPS },
  );
  const last = result.messages.at(-1);
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

export function subAgentTask({ args, facts }) {
  return [`Task: ${args.request}`, `Tenancy facts: ${JSON.stringify(facts)}`].join("\n");
}

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";

import { CONFIDENCE_THRESHOLD, FEATURE_GROUP_RATINGS } from "./tenancy.js";

const SHARED_RULES = `Call your tools with values taken exactly from the Tenancy facts given to you; never invent or guess a value.
If a tool returns an error, do not retry it yourself; report the error.
Finish with a short factual summary of what the tools returned, in English, without advice.`;

// Sub-agents the delegate node can run.
export const SUB_AGENTS = {
  official_data: {
    label: "OfficialDataAgent",
    tools: ["validate_berlin_address", "lookup_building_age"],
    prompt: `You are the Official Data Sub-agent of Amt-Buddy. You verify Berlin addresses against the official register.
After a successful address verification, always look up the building age with the returned coordinates.
${SHARED_RULES}`,
  },
  compliance: {
    label: "ComplianceAgent",
    tools: ["calculate_mietspiegel", "assess_occupancy_compliance"],
    prompt: `You are the Compliance Sub-agent of Amt-Buddy. You run only the checks you are asked for:
- mietspiegel: call calculate_mietspiegel with residentialLocation, buildingYear (as buildingAgeOrYear), livingAreaSqm and, if known, contractRent. The feature group ratings (featureGroups) are added automatically when all five are known; never rate them yourself.
- occupancy: call assess_occupancy_compliance with livingAreaSqm, rooms, occupants and childrenUpToSix.
${SHARED_RULES}`,
  },
  lease_analysis: {
    label: "LeaseAnalysisAgent",
    tools: ["extract_lease_data"],
    // Non-Tenancy inputs this Sub-agent is given.
    inputs: ["documentId"],
    prompt: `You are the Lease Analysis Sub-agent of Amt-Buddy. Extract the tenancy facts from the uploaded lease with extract_lease_data, passing the uploaded document's id.
Report which facts were found and flag every fact with confidence below ${CONFIDENCE_THRESHOLD} as needing the user's confirmation.
${SHARED_RULES}`,
  },
};

// The Compliance check each Compliance Tool performs.
const CHECK_FOR_TOOL = {
  calculate_mietspiegel: "mietspiegel",
  assess_occupancy_compliance: "occupancy",
};

// Tool arguments that must equal a Tenancy fact: tool → { argument: fact }.
const TOOL_ARG_FACTS = {
  validate_berlin_address: { address: "address" },
  calculate_mietspiegel: {
    residentialLocation: "residentialLocation",
    buildingAgeOrYear: "buildingYear",
    livingAreaSqm: "livingAreaSqm",
    contractRent: "contractRent",
  },
  assess_occupancy_compliance: {
    livingAreaSqm: "livingAreaSqm",
    rooms: "rooms",
    occupants: "occupants",
    childrenUpToSix: "childrenUpToSix",
  },
};

// Why a Tool may not run yet on these confirmed Tenancy values, or undefined.
// The building age belongs to a verified address, so it needs official coordinates.
// A Compliance Tool runs only for a check the Supervisor asked for (`checks`).
export function toolRefusal(toolName, facts, checks = []) {
  if (toolName === "lookup_building_age" && !facts.coordinates) {
    return "No verified coordinates: verify the address with validate_berlin_address first.";
  }
  const check = CHECK_FOR_TOOL[toolName];
  if (check && !checks.includes(check)) return `The ${check} check was not requested.`;
  return undefined;
}

// `featureGroups` from the five feature group ratings, or undefined unless all five are confirmed.
function featureGroupsFrom(facts) {
  const entries = Object.entries(FEATURE_GROUP_RATINGS).map(([group, fact]) => [group, facts[fact]]);
  return entries.every(([, rating]) => rating !== undefined) ? Object.fromEntries(entries) : undefined;
}

// Arguments pinned to confirmed Tenancy values, so a Sub-agent model cannot
// pass a Tool a value that differs from the Tenancy. An argument whose fact is
// not confirmed is pinned to undefined, so the model cannot supply its own value.
// Within an Official Data run, the coordinates come from the verification that just happened.
// The lease to read is always the uploaded document (`inputs.documentId`).
// The Mietspiegel feature groups come only from the tenant's five ratings.
export function pinnedArgs(toolName, facts, inputs = {}) {
  if (toolName === "lookup_building_age") return facts.coordinates ?? {};
  if (toolName === "extract_lease_data") return { documentId: inputs.documentId };
  const pinned = Object.fromEntries(Object.entries(TOOL_ARG_FACTS[toolName] ?? {}).map(([arg, fact]) => [arg, facts[fact]]));
  if (toolName === "calculate_mietspiegel") pinned.featureGroups = featureGroupsFrom(facts);
  return pinned;
}

const MAX_SUB_AGENT_STEPS = 12;

// Runs one Sub-agent as a small ReAct loop and returns its final summary text.
// The model is bound to the unwrapped Tools (`schemas`), so it sees their contracts;
// the calls themselves go to the wrapped Tools.
export async function runSubAgent({ agent, model, schemas, tools, task }) {
  const bound = model.bindTools(schemas);
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

export function subAgentTask({ agent, args, facts, inputs = {} }) {
  const lines = [`Task: ${args.request}`];
  if (args.checks) lines.push(`Checks: ${args.checks.join(", ")}`);
  if (SUB_AGENTS[agent].inputs?.includes("documentId") && inputs.documentId) {
    lines.push(`Uploaded document: ${inputs.documentId}`);
  }
  lines.push(`Tenancy facts: ${JSON.stringify(facts)}`);
  return lines.join("\n");
}

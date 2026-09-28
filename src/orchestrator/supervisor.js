import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

const request = z.string().describe("What the Sub-agent should do, in one or two sentences");

// Schema-only tool definitions: the graph's `delegate` node executes them.
export const SUPERVISOR_TOOLS = [
  {
    name: "ask_official_data_agent",
    description:
      "Verify the Tenancy's address against the official Berlin register and look up the official building age and Wohnlage. Needed before a Mietspiegel check.",
    schema: z.object({ request }),
  },
  {
    name: "ask_compliance_agent",
    description:
      "Run Compliance checks on the Tenancy: 'mietspiegel' (reference rent, and contract rent comparison if known) and/or 'occupancy' (§ 7 WoAufG Bln).",
    schema: z.object({ request, checks: z.array(z.enum(["mietspiegel", "occupancy"])).min(1) }),
  },
  {
    name: "ask_lease_analysis_agent",
    description: "Extract Tenancy facts from the lease document the user uploaded.",
    schema: z.object({ request }),
  },
];

export const AGENT_FOR_TOOL = {
  ask_official_data_agent: "official_data",
  ask_compliance_agent: "compliance",
  ask_lease_analysis_agent: "lease_analysis",
};

export function supervisorSystemMessage({ intents, language, documentId }) {
  const parts = [
    `You are the Orchestrator of Amt-Buddy, which helps tenants check their Berlin tenancy against official data and rules.
You never calculate anything yourself: you delegate to Sub-agents through your tools and then answer the user.

Rules:
- If a Sub-agent reports an upstream error or is unavailable, say so honestly. Never give a Compliance verdict from guessed or incomplete data.
- Every number in your answer must come from a Sub-agent result or what the user told you. Do not quote legal thresholds or figures from memory; point to the official source instead.
- Reply in the user's language (ISO code: ${language}). Keep German legal and official terms in German with a short gloss, e.g. "Nettokaltmiete (net cold rent)".
- Do not add a legal disclaimer; it is added automatically.`,
    `Intents of the latest message: ${intents.join(", ") || "(confirmation only)"}`,
  ];
  if (documentId) parts.push(`Uploaded document: ${documentId}`);
  return new SystemMessage(parts.join("\n\n"));
}

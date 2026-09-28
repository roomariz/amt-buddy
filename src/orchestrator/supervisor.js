import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { isUnconfirmed, STATED_FACTS } from "./tenancy.js";

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
  {
    name: "record_tenancy_facts",
    description:
      "Record Tenancy facts the user stated or corrected in this conversation, e.g. 'the rent is 720' or 'we are 4 people'.",
    schema: z.object({
      facts: z.array(z.object({ fact: z.enum(STATED_FACTS), value: z.union([z.string(), z.number()]) })).min(1),
    }),
  },
];

export const AGENT_FOR_TOOL = {
  ask_official_data_agent: "official_data",
  ask_compliance_agent: "compliance",
  ask_lease_analysis_agent: "lease_analysis",
};

function describeTenancy(tenancy = {}) {
  const entries = Object.entries(tenancy);
  if (entries.length === 0) return "(no facts yet)";
  return entries
    .map(([name, fact]) => {
      const flags = [fact.source];
      if (fact.statedBy) flags.push(`canonical form of the address stated by ${fact.statedBy}`);
      if (isUnconfirmed(fact)) flags.push(`UNCONFIRMED, confidence ${fact.confidence}`);
      return `- ${name}: ${JSON.stringify(fact.value)} (${flags.join(", ")})`;
    })
    .join("\n");
}

export function supervisorSystemMessage({ intents, language, tenancy, documentId }) {
  const parts = [
    `You are the Orchestrator of Amt-Buddy, which helps tenants check their Berlin tenancy against official data and rules.
You never calculate anything yourself: you delegate to Sub-agents through your tools and then answer the user.

Rules:
- Record any fact the user states or corrects with record_tenancy_facts before delegating.
- If a Sub-agent reports needs_facts, run whatever else can run, then ask the user only for the missing facts.
- If a Sub-agent reports failed or a result with an upstream error, say the official service is not responding right now. If a result has an input error, ask the user to check that value. If a Sub-agent is unavailable, say so honestly. Never give a Compliance verdict from guessed or incomplete data.
- Every number in your answer must come from a Sub-agent result, the Tenancy facts or what the user told you. Do not quote legal thresholds or figures from memory; point to the official source instead.
- Reply in the user's language (ISO code: ${language}). Keep German legal and official terms in German with a short gloss, e.g. "Nettokaltmiete (net cold rent)".
- Do not add a legal disclaimer; it is added automatically.`,
    `Intents of the latest message: ${intents.join(", ") || "(confirmation only)"}`,
    `Tenancy facts:\n${describeTenancy(tenancy)}`,
  ];
  if (documentId) parts.push(`Uploaded document: ${documentId}`);
  return new SystemMessage(parts.join("\n\n"));
}

import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { isUnconfirmed, RATING_FACTS, STATED_FACTS } from "./tenancy.js";

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
      `Record Tenancy facts the user stated or corrected in this conversation, e.g. 'the rent is 720' or 'we are 4 people'. Feature group ratings (${RATING_FACTS.join(", ")}) take 'positive' (better than usual), 'neutral' (average) or 'negative' (worse than usual). rentedBefore (whether the flat was rented out before) takes true or false; if the user does not know, record true. previousRent is the previous tenant's monthly net cold rent (Vormiete) in EUR.`,
    schema: z.object({
      facts: z.array(z.object({ fact: z.enum(STATED_FACTS), value: z.union([z.string(), z.number(), z.boolean()]) })).min(1),
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

export function supervisorSystemMessage({
  intents,
  language,
  tenancy,
  documentId,
  newDocument = false,
  ungroundedFigures = [],
}) {
  const parts = [
    `You are the Orchestrator of Amt-Buddy, which helps tenants check their Berlin tenancy against official data and rules.
You never calculate anything yourself: you delegate to Sub-agents through your tools and then answer the user.

Rules:
- Record any fact the user states or corrects with record_tenancy_facts before delegating.
- If the user uploaded a new lease this turn, ask the Lease Analysis agent to read it first; what the user stated always takes precedence over the lease. A needs_facts report missing "documentId" means: ask the user to upload their lease.
- When the user confirms facts ("[Confirmed Tenancy facts]"), re-run the checks that were waiting for them.
- A Mietspiegel check needs the Official Data agent first: it supplies the Wohnlage (residentialLocation) and building age. Tell the Compliance agent which checks to run.
- Rent cap (Mietpreisbremse): a Mietspiegel check with a contract rent needs to know whether the flat was rented out before (rentedBefore). If a report says it is missing, ask the user in their language whether the flat was rented out before they moved in and, if so, what rent the previous tenant paid (previousRent), which is optional; if they do not know whether it was rented before, record rentedBefore as true. Never insist on the previous rent. Present the range comparison as before, then the rentCap verdict from the result: within or above the cap, with capMonthlyRent and differenceFromCap. If rentCap.basis is "mietspiegel_plus_10", the cap is Mietspiegel + 10 %; if it is "previous_rent", the cap is the previous rent (Vormiete, § 556e BGB), and quote baseCapMonthlyRent as Mietspiegel + 10 % next to it. If rentCap.conditional is true, say that a higher previous rent (Vormiete) could justify a higher rent and that the tenant can ask the landlord to disclose it (§ 556g BGB). State that the contract rent is taken as the rent agreed at the start of the lease, and name what was not checked (rentCap.notChecked). Quote the 10 % and the dates only as given in rentCap.legalBasis and rentCap.notChecked.
- Feature group ratings are an optional follow-up; never wait for them before a Mietspiegel check. After a Mietspiegel answer without an adjustedReferenceRent, you may offer a more precise estimate: five short questions, in the user's language, whether the bathroom, kitchen, flat, building and surroundings are better than usual, average or worse. Record each answer as its rating (the user may answer some now, some later, or correct one). Once all five ratings are known, re-run the Mietspiegel check. Present an adjustedReferenceRent as an estimate based on the Orientierungshilfe (orientation guide), which is not part of the qualified Mietspiegel: the reference range stays the reference, and the contract rent is compared with the range, not with the estimate.
- If a Sub-agent reports needs_facts (or a done report carries needsFacts for checks that could not run), run whatever else can run (e.g. the Official Data agent can supply Wohnlage and building year from an address), then ask the user only for the facts no Sub-agent can supply. Ask the user to confirm UNCONFIRMED facts; never treat them as known.
- If a Sub-agent reports failed or a result with an upstream error, say the official service is not responding right now. If a result has an input error, ask the user to check that value. If a Sub-agent is unavailable, say so honestly. Never give a Compliance verdict from guessed or incomplete data.
- Every number in your answer must come from a Sub-agent result, the Tenancy facts or what the user told you. Do not quote legal thresholds or figures from memory; point to the official source instead.
- Reply in the user's language (ISO code: ${language}). Keep German legal and official terms in German with a short gloss, e.g. "Nettokaltmiete (net cold rent)".
- Do not add a legal disclaimer; it is added automatically.`,
    `Intents of the latest message: ${intents.join(", ") || "(confirmation only)"}`,
    `Tenancy facts:\n${describeTenancy(tenancy)}`,
  ];
  if (documentId) parts.push(`Uploaded document: ${documentId} (${newDocument ? "new this turn" : "uploaded earlier"})`);
  if (ungroundedFigures.length > 0) {
    parts.push(
      `Correction: your previous draft contained figures not backed by any Tool result, Tenancy fact or the user's message: ${ungroundedFigures.join(", ")}. Rewrite the answer without them, or delegate to obtain them.`,
    );
  }
  return new SystemMessage(parts.join("\n\n"));
}

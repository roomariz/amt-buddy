import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

export const INTENTS = ["general", "address", "mietspiegel", "occupancy", "document", "out_of_scope"];

export const intentSchema = z.object({
  intents: z.array(z.enum(INTENTS)).min(1).describe("Every Intent present in the latest user message"),
  language: z.string().describe("ISO 639-1 code of the language of the latest user message, e.g. 'de' or 'en'"),
});

export const ROUTER_PROMPT = `You classify the latest user message for Amt-Buddy, an assistant for tenants in Berlin.
Intents:
- general: general questions about renting or housing in Berlin
- address: verifying a Berlin address
- mietspiegel: rent level, Mietspiegel, ortsübliche Vergleichsmiete, "am I paying too much"
- occupancy: living space per person, overcrowding, § 7 WoAufG Bln
- document: an uploaded lease (Mietvertrag) or other tenancy document
- out_of_scope: anything unrelated to housing in Berlin
A message may have several Intents. A short answer to the assistant's previous question (e.g. "4 people", "yes") belongs to the Intents of that question, never out_of_scope.`;

const CONTEXT_MESSAGES = 6;

// The router sees the last few messages, so a short follow-up keeps the context of the question it answers.
export function routerMessages(messages) {
  return [new SystemMessage(ROUTER_PROMPT), ...messages.slice(-CONTEXT_MESSAGES)];
}

// out_of_scope only ever stands alone: mixed with a housing Intent, the request is in scope.
export function normalizeIntents(intents) {
  const unique = [...new Set(intents)];
  const inScope = unique.filter((intent) => intent !== "out_of_scope");
  return inScope.length > 0 ? inScope : ["out_of_scope"];
}

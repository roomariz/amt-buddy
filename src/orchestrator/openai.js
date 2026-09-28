import { ChatOpenAI } from "@langchain/openai";

// Builds the Orchestrator's models from the environment; no model name is hard-coded:
// OPENAI_MODEL (required): the chat model for the Supervisor and the Sub-agents.
// OPENAI_ROUTER_MODEL (optional): a cheaper model for Intent classification.
// OPENAI_API_KEY: the credentials (ChatOpenAI falls back to process.env when `env` lacks it).
export function createOpenAIModels(env = process.env) {
  const model = env.OPENAI_MODEL?.trim();
  if (!model) throw new Error("Set OPENAI_MODEL to the OpenAI chat model the Orchestrator should use");
  const create = (name) => new ChatOpenAI({ model: name, apiKey: env.OPENAI_API_KEY });
  const main = create(model);
  const routerModel = env.OPENAI_ROUTER_MODEL?.trim();
  const router = routerModel ? create(routerModel) : main;
  return { router, supervisor: main, subAgent: main };
}

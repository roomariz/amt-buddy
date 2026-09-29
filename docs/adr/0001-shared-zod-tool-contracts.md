# Tool contracts are shared zod schemas owned by the Orchestrator

The Orchestrator and its Tools are built in parallel by different people, so the contract between them lives in code: `src/orchestrator/tool-contracts.js` exports each Tool's name, description and input/output zod schema, teammates build their Tools with LangChain's `tool(fn, contract)`, and `createOrchestrator` refuses to start if an expected Tool is missing or misnamed. We chose this over a prose handoff document because a written spec drifts silently, while a checked contract fails at startup instead of mid-demo and lets the Orchestrator's tests run against stub Tools that satisfy exactly the same schemas.

## Consequences

Tools depend on `@langchain/core` and `zod`. Changing a contract is a coordinated change across the team, not a local edit.

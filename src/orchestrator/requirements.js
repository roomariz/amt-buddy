import { isUnconfirmed } from "./tenancy.js";

// Tenancy facts each Sub-agent needs before it may run.
const REQUIRED_FACTS = {
  official_data: ["address"],
};

// Which facts block a Sub-agent from running. Missing facts are absent from the
// Tenancy; unconfirmed facts are present but need the user's confirmation first.
export function blockingFacts(agent, tenancy) {
  const required = REQUIRED_FACTS[agent] ?? [];
  const missing = required.filter((name) => !tenancy[name]);
  const unconfirmed = required.filter((name) => isUnconfirmed(tenancy[name]));
  return { missing, unconfirmed, blocked: missing.length > 0 || unconfirmed.length > 0 };
}

import { isUnconfirmed } from "./tenancy.js";

// Tenancy facts each Sub-agent needs before it may run.
const REQUIRED_FACTS = {
  official_data: ["address"],
};

// Tenancy facts each Compliance check needs.
const CHECK_REQUIREMENTS = {
  mietspiegel: ["residentialLocation", "buildingYear", "livingAreaSqm"],
  occupancy: ["livingAreaSqm", "rooms", "occupants", "childrenUpToSix"],
};

function requiredFacts(agent, args) {
  if (agent === "compliance") {
    return [...new Set((args.checks ?? []).flatMap((check) => CHECK_REQUIREMENTS[check] ?? []))];
  }
  return REQUIRED_FACTS[agent] ?? [];
}

// Which facts block a Sub-agent from running. Missing facts are absent from the
// Tenancy; unconfirmed facts are present but need the user's confirmation first.
// An unconfirmed contract rent also blocks a Mietspiegel check even though the
// rent is optional there, so no Compliance verdict rests on an Unconfirmed fact.
export function blockingFacts(agent, args, tenancy) {
  const required = requiredFacts(agent, args);
  const missing = required.filter((name) => !tenancy[name]);
  const relevant = (args.checks ?? []).includes("mietspiegel") ? [...required, "contractRent"] : required;
  const unconfirmed = relevant.filter((name) => isUnconfirmed(tenancy[name]));
  return { missing, unconfirmed, blocked: missing.length > 0 || unconfirmed.length > 0 };
}

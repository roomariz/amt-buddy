import { isUnconfirmed } from "./tenancy.js";

// Tenancy facts each Sub-agent needs before it may run.
const REQUIRED_FACTS = {
  official_data: ["address"],
};

// Tenancy facts each Compliance check needs. An unconfirmed contract rent also
// blocks a Mietspiegel check even though the rent is optional there, so no
// Compliance verdict rests on an Unconfirmed fact.
const CHECK_REQUIREMENTS = {
  mietspiegel: { required: ["residentialLocation", "buildingYear", "livingAreaSqm"], mustBeConfirmed: ["contractRent"] },
  occupancy: { required: ["livingAreaSqm", "rooms", "occupants", "childrenUpToSix"], mustBeConfirmed: [] },
};

// Missing facts are absent from the Tenancy; unconfirmed facts are present but
// need the user's confirmation first.
function blockingFacts(tenancy, required, mustBeConfirmed = []) {
  const missing = required.filter((name) => !tenancy[name]);
  const unconfirmed = [...required, ...mustBeConfirmed].filter((name) => isUnconfirmed(tenancy[name]));
  return { missing, unconfirmed };
}

const isBlocked = ({ missing, unconfirmed }) => missing.length > 0 || unconfirmed.length > 0;
const union = (lists) => [...new Set(lists.flat())];

// Gating in code: splits a Sub-agent request into what may run now (`run`, the
// request's args, or null) and what lacks facts (`needsFacts`, or null).
// Each Compliance check is gated on its own, so a check whose facts are known
// still runs when another one of the same request is blocked.
export function gateSubAgent(agent, args, tenancy) {
  if (agent !== "compliance" || !args.checks?.length) {
    const blocking = blockingFacts(tenancy, REQUIRED_FACTS[agent] ?? []);
    return isBlocked(blocking) ? { run: null, needsFacts: blocking } : { run: args, needsFacts: null };
  }
  const gated = args.checks.map((check) => {
    const { required, mustBeConfirmed } = CHECK_REQUIREMENTS[check];
    return { check, ...blockingFacts(tenancy, required, mustBeConfirmed) };
  });
  const runnable = gated.filter((entry) => !isBlocked(entry)).map((entry) => entry.check);
  const blocked = gated.filter(isBlocked);
  return {
    run: runnable.length > 0 ? { ...args, checks: runnable } : null,
    needsFacts:
      blocked.length > 0
        ? {
            checks: blocked.map((entry) => entry.check),
            missing: union(blocked.map((entry) => entry.missing)),
            unconfirmed: union(blocked.map((entry) => entry.unconfirmed)),
          }
        : null,
  };
}

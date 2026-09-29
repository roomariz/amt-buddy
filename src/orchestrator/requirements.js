import { RENT_CAP_LEGAL_BASIS } from "../berlin-mietspiegel.js";
import { SUB_AGENTS } from "./sub-agents.js";
import { isUnconfirmed } from "./tenancy.js";

// Tenancy facts each Sub-agent needs before it may run.
const REQUIRED_FACTS = {
  official_data: ["address"],
};

// The year from which a flat never rented before may be a new build exempt from the Rent cap
// (first used after 1 October 2014, § 556f BGB).
const NEW_BUILD_YEAR = 2014;

// Whether the building year is known to be before NEW_BUILD_YEAR: a plain year, a closed
// period ending before it ("1991 - 2002") or "bis <year>". Open-ended periods ("nach 1945",
// "ab 2010") and an unknown year are not.
function builtBeforeNewBuildYear(buildingYear) {
  const value = buildingYear?.value;
  if (typeof value === "number") return value < NEW_BUILD_YEAR;
  const text = String(value ?? "").trim();
  const end = text.match(/^\d{4}\s*[-–]\s*(\d{4})$/) ?? text.match(/^bis\s*(\d{4})$/i);
  return end ? Number(end[1]) < NEW_BUILD_YEAR : false;
}

// Previous-rental facts the Rent cap verdict needs: whether the flat was rented before and,
// for a flat never rented that could be a new build, whether it was first used after 2014.
function previousRentalRequirements(tenancy) {
  if (!tenancy.contractRent) return [];
  const neverRented = tenancy.rentedBefore?.value === false;
  return neverRented && !builtBeforeNewBuildYear(tenancy.buildingYear) ? ["rentedBefore", "firstUsedAfter2014"] : ["rentedBefore"];
}

// Tenancy facts each Compliance check needs, given the Tenancy. An unconfirmed contract
// rent also blocks a Mietspiegel check even though the rent is optional there, so no
// Compliance verdict rests on an Unconfirmed fact. A known contract rent (confirmed or not)
// gets a Rent cap verdict, which needs the previous-rental facts.
const CHECK_REQUIREMENTS = {
  mietspiegel: (tenancy) => ({
    required: ["residentialLocation", "buildingYear", "livingAreaSqm", ...previousRentalRequirements(tenancy)],
    mustBeConfirmed: ["contractRent"],
  }),
  occupancy: () => ({ required: ["livingAreaSqm", "rooms", "occupants", "childrenUpToSix"], mustBeConfirmed: [] }),
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
// `inputs` holds the turn's non-Tenancy inputs, e.g. `{ documentId }`.
// Each Compliance check is gated on its own, so a check whose facts are known
// still runs when another one of the same request is blocked.
export function gateSubAgent(agent, args, tenancy, inputs = {}) {
  if (agent !== "compliance" || !args.checks?.length) {
    const blocking = blockingFacts(tenancy, REQUIRED_FACTS[agent] ?? []);
    // Non-Tenancy inputs a Sub-agent needs (Lease Analysis: the uploaded document) are missing too.
    blocking.missing.push(...(SUB_AGENTS[agent]?.inputs ?? []).filter((name) => !inputs[name]));
    return isBlocked(blocking) ? { run: null, needsFacts: blocking } : { run: args, needsFacts: null };
  }
  const gated = args.checks.map((check) => {
    const { required, mustBeConfirmed } = CHECK_REQUIREMENTS[check](tenancy);
    return { check, ...blockingFacts(tenancy, required, mustBeConfirmed) };
  });
  const runnable = gated.filter((entry) => !isBlocked(entry)).map((entry) => entry.check);
  const blocked = gated.filter(isBlocked);
  const missing = union(blocked.map((entry) => entry.missing));
  return {
    run: runnable.length > 0 ? { ...args, checks: runnable } : null,
    needsFacts:
      blocked.length > 0
        ? {
            checks: blocked.map((entry) => entry.check),
            missing,
            unconfirmed: union(blocked.map((entry) => entry.unconfirmed)),
            // The new-build question quotes 1 October 2014; the legal text grounds it.
            ...(missing.includes("firstUsedAfter2014") && { legalBasis: RENT_CAP_LEGAL_BASIS }),
          }
        : null,
  };
}

import { tool } from "@langchain/core/tools";

import { compareApplicants } from "./landlord-tools.js";
import { LANDLORD_TOOL_CONTRACTS } from "./tool-contracts.js";

// Fixed data in the shape of the real landlord Tools' results, by applicant id only.

const DEFAULT_CRITERIA = {
  weights: { affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 },
  requirements: {
    schufaCleanOnly: false,
    completeDocumentsOnly: false,
    maxRentToIncome: null,
    noPets: false,
    noSmoking: false,
    latestMoveIn: null,
    occupancyCompliant: true,
  },
};

const breakdown = (subscores) =>
  Object.fromEntries(
    Object.entries(subscores).map(([criterion, subscore]) => [criterion, { subscore, weight: DEFAULT_CRITERIA.weights[criterion] }]),
  );

const RANKED = [
  {
    applicantId: "A-001",
    rank: 1,
    matchScore: 94,
    breakdown: breakdown({ affordability: 1, schufa: 1, documents: 1, credibility: 1, employment: 1, previousLandlord: 1 }),
  },
  {
    applicantId: "A-004",
    rank: 2,
    matchScore: 81,
    breakdown: breakdown({ affordability: 0.8, schufa: 1, documents: 1, credibility: 0.85, employment: 0.6, previousLandlord: 0.5 }),
  },
  {
    applicantId: "A-002",
    rank: 3,
    matchScore: 67,
    breakdown: breakdown({ affordability: 0.6, schufa: 0.5, documents: 0.67, credibility: 0.7, employment: 1, previousLandlord: 1 }),
  },
];

const present = { status: "present", reason: null };

const PROFILES = {
  "A-001": {
    id: "A-001",
    householdSize: 2,
    household: { adults: 2, children: 0, childrenUpToSix: 0 },
    netHouseholdIncome: 4200,
    employmentType: "permanent",
    schufaStatus: "clean",
    moveInDate: "2026-12-01",
    pets: false,
    smoking: false,
    credibilityScore: 100,
    documentCheck: {
      schufa: present,
      incomeProof: present,
      previousLandlord: { ...present, arrears: false },
      complete: true,
      issues: [],
    },
  },
  "A-002": {
    id: "A-002",
    householdSize: 3,
    household: { adults: 2, children: 1, childrenUpToSix: 1 },
    netHouseholdIncome: 3100,
    employmentType: "civil_servant",
    schufaStatus: "minor_entries",
    moveInDate: "2027-01-15",
    pets: true,
    smoking: false,
    credibilityScore: 70,
    documentCheck: {
      schufa: { status: "expired", reason: "The SCHUFA-Auskunft was issued on 2026-04-02, more than 3 months ago." },
      incomeProof: present,
      previousLandlord: { ...present, arrears: false },
      complete: false,
      issues: [
        {
          document: "schufa",
          code: "schufa_expired",
          message: "The SCHUFA-Auskunft was issued on 2026-04-02, more than 3 months ago.",
        },
      ],
    },
  },
  "A-004": {
    id: "A-004",
    householdSize: 1,
    household: { adults: 1, children: 0, childrenUpToSix: 0 },
    netHouseholdIncome: 2900,
    employmentType: "fixed_term",
    schufaStatus: "clean",
    moveInDate: "2026-11-15",
    pets: false,
    smoking: false,
    credibilityScore: 85,
    documentCheck: {
      schufa: present,
      incomeProof: present,
      previousLandlord: { status: "not_required", reason: "First-time renter: there is no previous landlord.", arrears: null },
      complete: true,
      issues: [],
    },
  },
};

const RENT_CHECK = {
  askingRent: 700,
  askingRentPerSqm: 14,
  range: { lower: 420, median: 490, upper: 610 },
  position: "high",
  aboveCap: true,
  allowedRent: 539,
  differenceFromAllowed: 161,
  capPercent: 10,
};

function inputError(message) {
  const error = new Error(message);
  error.kind = "input";
  return error;
}

export const LANDLORD_STUB_HANDLERS = {
  get_ranking: () => ({
    criteria: DEFAULT_CRITERIA,
    stats: { total: 42, completeDocuments: 19, canAfford: 27, canAffordAtMedian: 33, cleanSchufa: 24, excluded: 5 },
    ranked: RANKED,
    excludedByReason: { occupancyCompliant: 5 },
    inactive: [],
  }),
  get_applicant_profile: ({ applicantId }) => {
    const profile = PROFILES[applicantId];
    if (!profile) throw inputError(`There is no applicant with the id ${applicantId}.`);
    const ranked = RANKED.find((entry) => entry.applicantId === applicantId);
    // Points per criterion (subscore × weight), as the real Tool computes them.
    const contributions = Object.fromEntries(
      Object.entries(ranked.breakdown).map(([criterion, { subscore, weight }]) => [criterion, subscore === null ? null : Math.round(subscore * weight * 10) / 10]),
    );
    return { profile, matchScore: ranked.matchScore, breakdown: ranked.breakdown, contributions, excludedBy: null, inactive: [] };
  },
  // The real Tool's comparison over the fixed ranking, so the two cannot drift apart.
  compare_applicants: ({ applicantIds }) => compareApplicants({ ranked: RANKED, excluded: [] }, applicantIds),
  update_selection_criteria: ({ changes }) => ({
    previous: DEFAULT_CRITERIA,
    criteria: {
      ...DEFAULT_CRITERIA,
      requirements: { ...DEFAULT_CRITERIA.requirements, ...Object.fromEntries(changes.map(({ requirement, value }) => [requirement, value])) },
    },
    top: RANKED,
    inactive: [],
  }),
  // Fixed: employment 15 → 30 %, the others scaled to fill the remaining 70 %.
  adjust_selection_criteria: () => ({
    previous: DEFAULT_CRITERIA,
    criteria: {
      ...DEFAULT_CRITERIA,
      weights: { affordability: 24.7, schufa: 16.5, documents: 12.4, credibility: 12.4, employment: 30, previousLandlord: 4.1 },
    },
    applied: [{ criterion: "employment", from: 15, requested: 30, to: 30, capped: false }],
    top: RANKED,
    inactive: [],
  }),
  update_flat_details: ({ facts }) => ({
    flat: { address: null, livingAreaSqm: null, rooms: null, askingRent: null, buildingYear: null, ...Object.fromEntries(facts.map(({ fact, value }) => [fact, value])) },
    missing: ["address"],
    rentCheck: null,
    note: "The Rent check needs the flat's address; still missing: address.",
    stats: { total: 42, completeDocuments: 19, canAfford: 27, canAffordAtMedian: null, cleanSchufa: 24, excluded: 5 },
    top: RANKED,
    inactive: [],
  }),
  remember_preference: ({ note }) => ({ noteId: "note-1", note }),
  update_shortlist: ({ applicantId, status, note }) => ({
    applicantId,
    status: status === "remove" ? "removed" : status,
    note: status === "remove" ? null : (note ?? null),
  }),
  get_rent_check: () => ({ rentCheck: RENT_CHECK, note: null }),
};

// Contract-conforming fake landlord Tools, for tests and for running the Landlord Orchestrator
// before the real Tools exist. `overrides` replaces a handler by Tool name; `calls` records every
// call as { name, args, landlordId } (the landlord comes from the call's config.configurable).
export function createLandlordStubTools(overrides = {}) {
  const calls = [];
  const tools = Object.values(LANDLORD_TOOL_CONTRACTS).map((contract) => {
    const handler = overrides[contract.name] ?? LANDLORD_STUB_HANDLERS[contract.name];
    return tool(
      async (args, config) => {
        calls.push({ name: contract.name, args, landlordId: config?.configurable?.landlordId });
        return handler(args);
      },
      { name: contract.name, description: contract.description, schema: contract.schema },
    );
  });
  return { tools, calls };
}

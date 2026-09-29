import { z } from "zod";

import { EMPLOYMENT_TYPES } from "../applicant-pool.js";

// The Landlord Orchestrator's Tool contracts (ADR 0001, for the landlord side): each Tool's name,
// description and input / output zod schema. The real Tools are built against these; the
// Orchestrator refuses to start without all of them. Tools see and return applicant ids only,
// never names, contact details or protected characteristics (AGG).

// The scoring criteria of the Selection criteria, each weighted.
export const SELECTION_CRITERIA = ["affordability", "schufa", "documents", "credibility", "employment", "previousLandlord"];
export const SHORTLIST_STATUSES = ["to_invite", "invited", "declined"];
export const SCHUFA_STATUSES = ["clean", "minor_entries", "negative", "missing"];
// The flat facts a Listing needs; one that is missing switches off what depends on it.
export const FLAT_FACTS = ["address", "livingAreaSqm", "rooms", "askingRent"];

const applicantId = z.string().min(1).describe("The applicant's id, e.g. 'A-007'");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const weights = z.object(Object.fromEntries(SELECTION_CRITERIA.map((criterion) => [criterion, z.number().min(0)])));

const requirements = z.object({
  schufaCleanOnly: z.boolean(),
  completeDocumentsOnly: z.boolean(),
  maxRentToIncome: z.number().positive().max(1).nullable(),
  noPets: z.boolean(),
  noSmoking: z.boolean(),
  latestMoveIn: day.nullable(),
  occupancyCompliant: z.boolean(),
});

// Selection criteria: weights per criterion (normalised to sum to 100) and the hard Requirements.
const selectionCriteria = z.looseObject({ weights, requirements });

// Match score breakdown: per criterion, the subscore (0–1; null while the criterion is inactive)
// and its weight (% of the Match score, 0 while inactive).
const breakdown = z.object(
  Object.fromEntries(
    SELECTION_CRITERIA.map((criterion) => [criterion, z.looseObject({ subscore: z.number().min(0).max(1).nullable(), weight: z.number().min(0) })]),
  ),
);

// What a missing flat fact switches off: a criterion (its share is 0, the others renormalised) or a
// Requirement (not evaluated), with the facts it waits for.
const inactive = z.array(
  z.looseObject({
    criterion: z.enum(SELECTION_CRITERIA).optional(),
    requirement: z.string().optional(),
    missing: z.array(z.enum(FLAT_FACTS)).min(1),
  }),
);

const rankedApplicant = z.looseObject({
  applicantId,
  rank: z.number().int().min(1),
  matchScore: z.number().min(0).max(100),
  breakdown,
});

const documentResult = z.looseObject({
  status: z.enum(["present", "missing", "expired", "inconsistent", "not_required"]),
  reason: z.string().nullable(),
});

// The Applicant profile (src/landlord/applicant-pool.js): the anonymised view, never a name.
const applicantProfile = z.strictObject({
  id: applicantId,
  householdSize: z.number().int().min(1),
  household: z.object({ adults: z.number().int().min(1), children: z.number().int().min(0), childrenUpToSix: z.number().int().min(0) }),
  netHouseholdIncome: z.number().positive(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  schufaStatus: z.enum(SCHUFA_STATUSES),
  moveInDate: day,
  pets: z.boolean(),
  smoking: z.boolean(),
  credibilityScore: z.number().min(0).max(100),
  documentCheck: z.looseObject({
    schufa: documentResult,
    incomeProof: documentResult,
    previousLandlord: documentResult.extend({ arrears: z.boolean().nullable() }),
    complete: z.boolean(),
    issues: z.array(z.looseObject({ document: z.string(), code: z.string(), message: z.string() })),
  }),
});

const rentCheck = z.looseObject({
  askingRent: z.number(),
  range: z.object({ lower: z.number(), median: z.number(), upper: z.number() }),
  position: z.enum(["low", "typical", "high"]),
  aboveCap: z.boolean(),
  allowedRent: z.number(),
  differenceFromAllowed: z.number(),
});

const stats = z.looseObject({
  total: z.number().int().min(0),
  completeDocuments: z.number().int().min(0),
  canAfford: z.number().int().min(0).nullable(),
  canAffordAtMedian: z.number().int().min(0).nullable(),
  cleanSchufa: z.number().int().min(0),
  excluded: z.number().int().min(0),
});

export const LANDLORD_TOOL_CONTRACTS = {
  get_ranking: {
    name: "get_ranking",
    description:
      "Get the current ranking of the applicants under the landlord's Selection criteria: the top applicants with their Match score (0–100) and its breakdown per criterion, the pool statistics, how many applicants each Requirement excluded, and what is not counted yet because a flat fact is missing ('inactive').",
    schema: z.object({}),
    output: z.looseObject({
      criteria: selectionCriteria,
      stats,
      ranked: z.array(rankedApplicant),
      excludedByReason: z.record(z.string(), z.number().int().min(0)),
      inactive,
    }),
  },
  get_applicant_profile: {
    name: "get_applicant_profile",
    description:
      "Get one applicant's anonymised Applicant profile (household, income, employment type, SCHUFA status, move-in date, pets, smoking), their Document check and Credibility score, and their Match score breakdown, or the Requirement that excluded them.",
    schema: z.object({ applicantId }),
    output: z.looseObject({
      profile: applicantProfile,
      matchScore: z.number().min(0).max(100).nullable(),
      breakdown: breakdown.nullable(),
      excludedBy: z.string().nullable(),
      inactive,
    }),
  },
  update_selection_criteria: {
    name: "update_selection_criteria",
    description:
      "Switch the landlord's Requirements (hard filters) on or off, or change their limits. Not for weights: use adjust_selection_criteria. Saves them and returns the old and new criteria and the new top 3.",
    // Strict, so that weights are refused rather than dropped: they change only through
    // adjust_selection_criteria, under its limits.
    schema: z.strictObject({
      requirements: requirements.partial().describe("Requirements to change"),
    }),
    output: z.looseObject({ previous: selectionCriteria, criteria: selectionCriteria, top: z.array(rankedApplicant).max(3), inactive }),
  },
  adjust_selection_criteria: {
    name: "adjust_selection_criteria",
    description:
      "Change how much criteria count, relative to their saved shares: per criterion a factor (1.3 = 30 % more, 1.5 = much more, 0.7 = less, 2 = double, 0.5 = halve, 0 = ignore) or a target share in %. The criteria not named keep their proportions and fill the rest to 100 %. No share can exceed 50 % (a request above is capped). Saves them and returns the old and new criteria (shares in %), what was applied (from, requested, to, capped) and the new top 3.",
    schema: z.object({
      changes: z
        .array(
          z.object({
            criterion: z.enum(SELECTION_CRITERIA),
            factor: z.number().min(0).optional().describe("Multiplies the saved share; give this or share"),
            share: z.number().min(0).max(100).optional().describe("The new share in %; give this or factor"),
          }),
        )
        .min(1),
    }),
    output: z.looseObject({
      previous: selectionCriteria,
      criteria: selectionCriteria,
      applied: z.array(
        z.looseObject({ criterion: z.enum(SELECTION_CRITERIA), from: z.number(), requested: z.number(), to: z.number().min(0).max(50), capped: z.boolean() }),
      ),
      top: z.array(rankedApplicant).max(3),
      inactive,
    }),
  },
  update_flat_details: {
    name: "update_flat_details",
    description:
      "Save facts about the landlord's flat as they give them: address (street, house number and postal code), living area, rooms, asking net cold rent, building year. Once address, size, rooms and rent are all known, builds the Listing and its Rent check (Berliner Mietspiegel, Mietpreisbremse). Returns the saved details, what is still missing, the Rent check (or a note why there is none), the pool statistics, the new top 3 and what is not counted yet.",
    schema: z.object({
      address: z.string().optional().describe("Street, house number and postal code, e.g. 'Wühlischstraße 30, 10245 Berlin'"),
      livingAreaSqm: z.number().optional().describe("Living area in m²"),
      rooms: z.number().optional(),
      askingRent: z.number().optional().describe("Asking net cold rent (Nettokaltmiete) per month in EUR"),
      buildingYear: z.number().int().optional().describe("Only when the landlord states it"),
    }),
    output: z.looseObject({
      flat: z.object({
        address: z.string().nullable(),
        livingAreaSqm: z.number().nullable(),
        rooms: z.number().nullable(),
        askingRent: z.number().nullable(),
        buildingYear: z.number().nullable(),
      }),
      missing: z.array(z.enum(FLAT_FACTS)),
      rentCheck: rentCheck.nullable(),
      note: z.string().nullable(),
      stats,
      top: z.array(rankedApplicant).max(3),
      inactive,
    }),
  },
  remember_preference: {
    name: "remember_preference",
    description:
      "Remember a free-text preference the landlord stated (e.g. 'I'd like someone who stays long-term'), so it is known in later conversations. Never store anything about protected characteristics.",
    schema: z.object({ note: z.string().min(1).max(500) }),
    output: z.looseObject({ noteId: z.string(), note: z.string() }),
  },
  update_shortlist: {
    name: "update_shortlist",
    description:
      "Add an applicant to the landlord's Shortlist or change their entry: status 'to_invite', 'invited' or 'declined', with an optional short note; status 'remove' takes them off the Shortlist.",
    schema: z.object({
      applicantId,
      status: z.enum([...SHORTLIST_STATUSES, "remove"]),
      note: z.string().max(500).optional(),
    }),
    output: z.looseObject({
      applicantId,
      status: z.enum([...SHORTLIST_STATUSES, "removed"]),
      note: z.string().nullable(),
    }),
  },
  get_rent_check: {
    name: "get_rent_check",
    description:
      "Get the Rent check of the landlord's Listing: the Berliner Mietspiegel range for the flat, where the asking rent sits in it, and whether it is above Mietspiegel + 10 % (Mietpreisbremse) with the rent that would be allowed.",
    schema: z.object({}),
    output: z.looseObject({
      rentCheck: rentCheck.nullable(),
      note: z.string().nullable(),
    }),
  },
};

export const LANDLORD_TOOL_NAMES = Object.keys(LANDLORD_TOOL_CONTRACTS);

// → Map name → Tool; throws when a contract has no Tool (missing or misnamed) or a Tool is not a
// LangChain tool.
export function assertLandlordToolsMatchContracts(tools) {
  const byName = new Map(tools.map((candidate) => [candidate.name, candidate]));
  const missing = LANDLORD_TOOL_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Landlord Orchestrator is missing required tools: ${missing.join(", ")}`);
  }
  for (const name of LANDLORD_TOOL_NAMES) {
    if (typeof byName.get(name).invoke !== "function") {
      throw new Error(`Tool ${name} is not a LangChain tool (no invoke method)`);
    }
  }
  return byName;
}

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

// Match score breakdown: per criterion, the subscore (0–1) and its weight.
const breakdown = z.object(
  Object.fromEntries(
    SELECTION_CRITERIA.map((criterion) => [criterion, z.looseObject({ subscore: z.number().min(0).max(1), weight: z.number().min(0) })]),
  ),
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

const stats = z.looseObject({
  total: z.number().int().min(0),
  completeDocuments: z.number().int().min(0),
  canAfford: z.number().int().min(0),
  canAffordAtMedian: z.number().int().min(0).nullable(),
  cleanSchufa: z.number().int().min(0),
  excluded: z.number().int().min(0),
});

export const LANDLORD_TOOL_CONTRACTS = {
  get_ranking: {
    name: "get_ranking",
    description:
      "Get the current ranking of the applicants under the landlord's Selection criteria: the top applicants with their Match score (0–100) and its breakdown per criterion, the pool statistics, and how many applicants each Requirement excluded.",
    schema: z.object({}),
    output: z.looseObject({
      criteria: selectionCriteria,
      stats,
      ranked: z.array(rankedApplicant),
      excludedByReason: z.record(z.string(), z.number().int().min(0)),
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
    }),
  },
  update_selection_criteria: {
    name: "update_selection_criteria",
    description:
      "Change the landlord's Selection criteria: new weights for some criteria (the rest keep theirs; all are normalised to sum to 100) and/or Requirements to switch on or off. Saves them and returns the old and new criteria and the new top 3.",
    schema: z.object({
      weights: weights.partial().optional().describe("Relative weights per criterion to change"),
      requirements: requirements.partial().optional().describe("Requirements to change"),
    }),
    output: z.looseObject({ previous: selectionCriteria, criteria: selectionCriteria, top: z.array(rankedApplicant).max(3) }),
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
      rentCheck: z
        .looseObject({
          askingRent: z.number(),
          range: z.object({ lower: z.number(), median: z.number(), upper: z.number() }),
          position: z.enum(["low", "typical", "high"]),
          aboveCap: z.boolean(),
          allowedRent: z.number(),
          differenceFromAllowed: z.number(),
        })
        .nullable(),
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

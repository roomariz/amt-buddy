import { z } from "zod";

const residentialLocation = z.enum(["einfach", "mittel", "gut"]);

const address = z.looseObject({
  street: z.string(),
  houseNumber: z.string(),
  postalCode: z.string(),
  district: z.string().nullable(),
  coordinates: z.object({ longitude: z.number(), latitude: z.number() }).nullable(),
  residentialLocation: residentialLocation.nullable(),
});

// The five Mietspiegel Orientierungshilfe feature groups, and a Feature group rating:
// its positive features outweigh the negative ones, they balance, or the negative ones outweigh.
export const FEATURE_GROUPS = ["bathroom", "kitchen", "apartment", "building", "surroundings"];
export const FEATURE_RATINGS = ["positive", "neutral", "negative"];
const featureRating = z.enum(FEATURE_RATINGS);

const extractedField = (value) => z.object({ value, confidence: z.number().min(0).max(1) });

export const TOOL_CONTRACTS = {
  validate_berlin_address: {
    name: "validate_berlin_address",
    description:
      "Verify a Berlin address against the official address register. Returns the official address, its coordinates and its Mietspiegel residential location (Wohnlage).",
    schema: z.object({
      address: z.string().describe("Free-form address, e.g. 'Berliner Straße 155, 10715 Berlin'"),
    }),
    output: z.looseObject({ verified: z.boolean(), address: address.nullable() }),
  },
  lookup_building_age: {
    name: "lookup_building_age",
    description:
      "Look up the official predominant construction period of the residential block at the given coordinates.",
    schema: z.object({ longitude: z.number(), latitude: z.number() }),
    output: z.looseObject({ predominantConstructionPeriod: z.string().nullable() }),
  },
  calculate_mietspiegel: {
    name: "calculate_mietspiegel",
    description:
      "Calculate the Berliner Mietspiegel 2026 reference rent range and compare an optional contract net cold rent against it. With the five feature group ratings, also estimate an adjusted reference rent within the range. With a contract rent and whether the flat was rented before, also give the Mietpreisbremse rent cap verdict (Mietspiegel + 10 %, or a higher previous rent).",
    schema: z.object({
      residentialLocation,
      buildingAgeOrYear: z.union([z.number(), z.string()]),
      livingAreaSqm: z.number().positive(),
      contractRent: z.number().positive().optional(),
      featureGroups: z
        .object(Object.fromEntries(FEATURE_GROUPS.map((group) => [group, featureRating])))
        .optional()
        .describe("Orientierungshilfe ratings of all five feature groups; adds an adjustedReferenceRent estimate"),
      rentedBefore: z
        .boolean()
        .optional()
        .describe("Whether the flat was rented out before; with contractRent adds the rentCap (Mietpreisbremse) verdict"),
      previousRent: z
        .number()
        .positive()
        .optional()
        .describe("The previous tenant's monthly net cold rent (Vormiete) in EUR, for a flat rented before; a higher one becomes the rent cap"),
    }),
    output: z.looseObject({ status: z.string() }),
  },
  assess_occupancy_compliance: {
    name: "assess_occupancy_compliance",
    description: "Check the minimum living area per person under § 7 WoAufG Bln.",
    schema: z.object({
      livingAreaSqm: z.number().positive(),
      rooms: z.number().positive(),
      occupants: z.number().int().min(1),
      childrenUpToSix: z.number().int().min(0),
    }),
    output: z.looseObject({ status: z.string() }),
  },
  extract_lease_data: {
    name: "extract_lease_data",
    description: "Extract tenancy facts from an uploaded lease document, each with a confidence between 0 and 1.",
    schema: z.object({ documentId: z.string() }),
    output: z.looseObject({
      fields: z.object({
        address: extractedField(z.string()).optional(),
        contractRent: extractedField(z.number()).optional(),
        livingAreaSqm: extractedField(z.number()).optional(),
        rooms: extractedField(z.number()).optional(),
        buildingYear: extractedField(z.number()).optional(),
        occupants: extractedField(z.number()).optional(),
        childrenUpToSix: extractedField(z.number()).optional(),
      }),
    }),
  },
};

export const TOOL_NAMES = Object.keys(TOOL_CONTRACTS);

export function assertToolsMatchContracts(tools) {
  const byName = new Map(tools.map((candidate) => [candidate.name, candidate]));
  const missing = TOOL_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Orchestrator is missing required tools: ${missing.join(", ")}`);
  }
  for (const name of TOOL_NAMES) {
    if (typeof byName.get(name).invoke !== "function") {
      throw new Error(`Tool ${name} is not a LangChain tool (no invoke method)`);
    }
  }
  return byName;
}

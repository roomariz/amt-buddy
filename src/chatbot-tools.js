import { verifyBerlinAddress } from "./berlin-address.js";
import { evaluateMietspiegel } from "./berlin-mietspiegel.js";
import { assessOccupancy } from "./occupancy-assessment.js";
import { processDocumentOcr } from "./ocr-extraction.js";

/**
 * Standard tool definition schema for Amt-Buddy Orchestrator & LLM function calling.
 */
export const CHATBOT_TOOLS = {
  validate_berlin_address: {
    name: "validate_berlin_address",
    description:
      "Validates a Berlin address against the official open address dataset published by Amt für Statistik Berlin-Brandenburg, retrieves official Wohnlage and building construction age, and optionally evaluates Mietspiegel reference rent and § 7 WoAufG Bln occupancy compliance.",
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Full Berlin address, e.g. 'Berliner Straße 155, 10715 Berlin'.",
        },
        street: { type: "string", description: "Street name." },
        houseNumber: { type: "string", description: "House number with optional suffix." },
        postalCode: { type: "string", description: "Berlin postal code (10000–14199)." },
        livingAreaSqm: { type: "number", description: "Living area in m²." },
        contractRent: { type: "number", description: "Net cold rent in EUR." },
        buildingYear: { type: "number", description: "Building construction year." },
        rooms: { type: "number", description: "Number of rooms." },
        occupants: { type: "number", description: "Number of occupants." },
        childrenUpToSix: { type: "number", description: "Children up to 6 years old." },
      },
      required: [],
    },
    execute: async (params) => {
      return await verifyBerlinAddress(params);
    },
  },

  calculate_mietspiegel: {
    name: "calculate_mietspiegel",
    description:
      "Evaluates the official Berliner Mietspiegel 2026 reference rent range for an apartment based on Wohnlage, building age, and size, and compares contract rent against the statutory range.",
    parameters: {
      type: "object",
      properties: {
        residentialLocation: {
          type: "string",
          enum: ["einfach", "mittel", "gut"],
          description: "Residential location category (Wohnlage).",
        },
        buildingAgeOrYear: {
          type: "string",
          description: "Construction year or decade, e.g. 1935 or '1919–1949'.",
        },
        livingAreaSqm: {
          type: "number",
          description: "Living area in square meters.",
        },
        contractRent: {
          type: "number",
          description: "Optional contractual net cold rent in EUR to compare.",
        },
      },
      required: ["residentialLocation", "buildingAgeOrYear", "livingAreaSqm"],
    },
    execute: async (params) => {
      return evaluateMietspiegel(params);
    },
  },

  assess_occupancy_compliance: {
    name: "assess_occupancy_compliance",
    description:
      "Assesses whether a dwelling satisfies the statutory minimum floor area standards under § 7 Abs. 1 WoAufG Bln (9 m² per person, 6 m² per child up to 6).",
    parameters: {
      type: "object",
      properties: {
        livingAreaSqm: { type: "number", description: "Total living area in m²." },
        rooms: { type: "number", description: "Number of rooms in dwelling." },
        occupants: { type: "number", description: "Total occupants." },
        childrenUpToSix: { type: "number", description: "Children up to 6 years old." },
      },
      required: ["livingAreaSqm", "rooms", "occupants"],
    },
    execute: async (params) => {
      return assessOccupancy(params);
    },
  },

  extract_document_ocr: {
    name: "extract_document_ocr",
    description:
      "Extracts tenancy facts (address, net cold rent, living area, construction year, rooms, occupants, children) from a rental contract (Mietvertrag) or landlord confirmation (Wohnungsgeberbestätigung).",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Raw contract or document text." },
        file: { type: "string", description: "Base64 encoded PDF or image data." },
        mimeType: { type: "string", description: "MIME type, e.g. 'application/pdf'." },
        fileName: { type: "string", description: "File name." },
      },
      required: [],
    },
    execute: async (params) => {
      return await processDocumentOcr(params);
    },
  },
};

/**
 * Returns JSON Schema definitions for all tools.
 */
export function getToolSchemas() {
  return Object.values(CHATBOT_TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Executes a tool by name with arguments and handles execution safety.
 */
export async function executeTool(name, params) {
  const tool = CHATBOT_TOOLS[name];
  if (!tool) {
    throw new Error(`Tool '${name}' is not recognized.`);
  }

  const startTime = Date.now();
  try {
    const result = await tool.execute(params);
    return {
      success: true,
      name,
      executionTimeMs: Date.now() - startTime,
      result,
    };
  } catch (error) {
    return {
      success: false,
      name,
      executionTimeMs: Date.now() - startTime,
      error: {
        message: error.message,
        details: error.details,
      },
    };
  }
}

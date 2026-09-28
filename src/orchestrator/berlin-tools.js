import { tool } from "@langchain/core/tools";

import { AddressInputError, BERLIN_ADDRESS_SOURCE, lookupBerlinAddress, parseAddressInput } from "../berlin-address.js";
import {
  BERLIN_RESIDENTIAL_LOCATION_SOURCE,
  getBerlinResidentialLocation,
} from "../berlin-residential-location.js";
import { BERLIN_BUILDING_AGE_SOURCE, getBerlinBuildingAgeArea } from "../berlin-building-age.js";
import { evaluateMietspiegel } from "../berlin-mietspiegel.js";
import { assessOccupancy } from "../occupancy-assessment.js";
import { createDocumentStore } from "../document-store.js";
import { leaseFieldsFromOcr } from "./lease-fields.js";
import { TOOL_CONTRACTS } from "./tool-contracts.js";
import { DEFAULT_TOOL_TIMEOUT_MS } from "./tool-wrapper.js";

// The register matches street names exactly (case-insensitive), and parseAddressInput
// wants a comma or line break right before the postal code. Chat addresses often have neither:
// "Berliner Str. 155 10715" and "Berliner Str. 155, Berlin 10715" become "Berliner Straße 155, 10715";
// "Berliner Straße 155 10715, Berlin" becomes "Berliner Straße 155, 10715 Berlin".
function tidyChatAddress(address) {
  return String(address)
    .replace(/(s)tr\.(?=[\s,\d]|$)/giu, "$1traße")
    .replace(/(s)trasse(?=[\s,\d]|$)/giu, "$1traße")
    .replace(/,[ \t]*Berlin[ \t]+(\d{5})(?=[\s,]|$)/iu, ", $1")
    .replace(/(\d[ \t]*[a-z]?)[ \t]+(\d{5})(?=[\s,]|$)/iu, "$1, $2")
    .replace(/(,[ \t]*\d{5})[ \t]*,[ \t]*(?=\S)/u, "$1 ");
}

const MISSING_PARTS =
  "The address needs street, house number and postal code, e.g. 'Berliner Straße 155, 10715 Berlin'.";

// parseAddressInput's message is generic ("Address input is invalid") and its format hint
// is written for the web form; the Supervisor needs to know what to ask the user for.
function parseChatAddress(address) {
  try {
    return parseAddressInput({ address: tidyChatAddress(address) });
  } catch (error) {
    if (!(error instanceof AddressInputError)) throw error;
    error.message = error.details.some((detail) => detail.field === "address")
      ? MISSING_PARTS
      : error.details.map((detail) => detail.message).join(" ");
    throw error;
  }
}

async function validateBerlinAddress({ address }, services) {
  const official = await lookupBerlinAddress(parseChatAddress(address), services);
  if (!official) return { verified: false, address: null };

  const residentialLocation = await getBerlinResidentialLocation(official, services);
  return {
    verified: true,
    address: {
      street: official.street,
      houseNumber: official.houseNumber,
      postalCode: official.postalCode,
      district: official.district,
      locality: official.locality,
      coordinates: official.coordinates,
      residentialLocation: residentialLocation?.classification ?? null,
    },
    sources: { address: BERLIN_ADDRESS_SOURCE, residentialLocation: BERLIN_RESIDENTIAL_LOCATION_SOURCE },
  };
}

async function lookupBuildingAge({ longitude, latitude }, services) {
  const area = await getBerlinBuildingAgeArea({ longitude, latitude }, services);
  if (!area) {
    return {
      predominantConstructionPeriod: null,
      note: "No official building-age data for these coordinates.",
      source: BERLIN_BUILDING_AGE_SOURCE,
    };
  }
  return {
    predominantConstructionPeriod: area.predominantConstructionPeriod,
    urbanStructure: area.urbanStructure,
    buildingSpecific: false,
    note: "Predominant construction period of the residential block, not the building's own year.",
    source: BERLIN_BUILDING_AGE_SOURCE,
  };
}

export class LeaseDocumentInputError extends Error {
  constructor() {
    super("The uploaded lease document is unknown or has expired. Ask the user to upload the lease again.");
    this.name = "LeaseDocumentInputError";
  }
}

function extractLeaseData({ documentId }, { documents }) {
  const document = documents.get(documentId);
  if (!document) throw new LeaseDocumentInputError();
  return { fields: leaseFieldsFromOcr(document.extraction) };
}

const HANDLERS = {
  validate_berlin_address: validateBerlinAddress,
  lookup_building_age: lookupBuildingAge,
  calculate_mietspiegel: evaluateMietspiegel,
  assess_occupancy_compliance: assessOccupancy,
  extract_lease_data: extractLeaseData,
};

// The Tools backed by the official Berlin services, the real calculations and the lease
// OCR: a complete Tool set for createOrchestrator. `fetchImpl` replaces the global fetch
// for every Berlin service request.
// `timeoutMs` is one call's budget for all its requests (address plus Wohnlage lookup);
// keep it equal to createOrchestrator's `toolTimeoutMs`, so a request is aborted when the
// Tool wrapper gives up on the attempt instead of running on beside its retry.
// No retries here: the Tool wrapper retries upstream errors once.
// `documents` is the store the upload endpoint puts `{ extraction, text }` into
// (`extraction` is parseTenancyDocument's result); `extract_lease_data` reads it by documentId.
export function createBerlinTools({
  fetchImpl,
  timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  documents = createDocumentStore(),
} = {}) {
  const tools = Object.entries(HANDLERS).map(([name, handler]) => {
    const { description, schema } = TOOL_CONTRACTS[name];
    return tool((args) => handler(args, { fetchImpl, documents, signal: AbortSignal.timeout(timeoutMs) }), {
      name,
      description,
      schema,
    });
  });
  return { tools };
}

import { readJson, sendError, sendJson } from "../http-json.js";
import { buildListing, ListingInputError } from "./listing.js";
import { normalizeLandlordName } from "./store.js";

const MAX_NAME_LENGTH = 100;
const LANDLORD_PATH = "/api/v1/landlord/";

class LandlordInputError extends Error {
  constructor(details) {
    super(details[0]?.message ?? "Landlord request is invalid.");
    this.name = "LandlordInputError";
    this.details = details;
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function nameProblem(input) {
  const name = isPlainObject(input) && typeof input.name === "string" ? normalizeLandlordName(input.name) : "";
  if (name && name.length <= MAX_NAME_LENGTH) return null;
  return {
    field: "name",
    code: "required",
    message: `'name' must be a non-empty string of at most ${MAX_NAME_LENGTH} characters.`,
  };
}

function decodeId(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// The landlord side's HTTP API under /api/v1/landlord/ (docs/api.md, "Landlord").
// - getStore(): the landlord store (see createLandlordStore), opened on first use.
// - fetchImpl: the fetch for the Berlin services (default: the global fetch).
// handle(request, response, url) answers a landlord request and returns true, or returns
// false when the request is not a landlord one.
export function createLandlordApi({ getStore, fetchImpl }) {
  async function readBody(request, response) {
    try {
      return { input: await readJson(request, 16_384, LandlordInputError) };
    } catch (error) {
      if (!(error instanceof LandlordInputError)) throw error;
      sendError(response, 422, "validation_error", error.message, error.details);
      return null;
    }
  }

  // POST /api/v1/landlord/sessions { name } → { landlordId, name }
  async function signIn(request, response) {
    const body = await readBody(request, response);
    if (!body) return;
    const problem = nameProblem(body.input);
    if (problem) {
      sendError(response, 422, "validation_error", problem.message, [problem]);
      return;
    }
    sendJson(response, 200, { data: getStore().signIn(body.input.name) });
  }

  // GET /api/v1/landlord/:landlordId/dashboard → { listing, rentCheck }
  function dashboard(response, landlordId) {
    const listing = getStore().getListing(landlordId);
    sendJson(response, 200, { data: { listing, rentCheck: listing?.rentCheck ?? null } });
  }

  // PUT /api/v1/landlord/:landlordId/listing { address, livingAreaSqm, rooms, askingRent, buildingYear? }
  // → the saved Listing with its Rent check (or a `note` saying why there is none).
  async function saveListing(request, response, landlordId) {
    const body = await readBody(request, response);
    if (!body) return;
    let listing;
    try {
      listing = await buildListing(body.input, { fetchImpl });
    } catch (error) {
      if (!(error instanceof ListingInputError)) throw error;
      sendError(response, 422, "validation_error", error.message, error.details);
      return;
    }
    sendJson(response, 200, { data: getStore().saveListing(landlordId, listing) });
  }

  const routes = {
    "GET dashboard": (request, response, landlordId) => dashboard(response, landlordId),
    "PUT listing": saveListing,
  };

  return {
    async handle(request, response, url) {
      if (!url.pathname.startsWith(LANDLORD_PATH)) return false;
      const path = url.pathname.slice(LANDLORD_PATH.length);
      if (request.method === "POST" && path === "sessions") {
        await signIn(request, response);
        return true;
      }
      const match = /^([^/]+)\/(dashboard|listing)$/.exec(path);
      const handler = match && routes[`${request.method} ${match[2]}`];
      if (!handler) {
        sendError(response, 404, "not_found", "No such landlord endpoint.");
        return true;
      }
      const landlordId = decodeId(match[1]);
      if (!landlordId || !getStore().getLandlord(landlordId)) {
        sendError(response, 404, "landlord_not_found", "No landlord with this id. Sign in again.");
        return true;
      }
      await handler(request, response, landlordId);
      return true;
    },
  };
}

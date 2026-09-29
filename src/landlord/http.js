import { readJson, sendError, sendJson } from "../http-json.js";
import { streamEvents } from "../http-sse.js";
import { buildListing, ListingInputError } from "./listing.js";
import { detectLanguage, landlordReply } from "./orchestrator/replies.js";
import { DEFAULT_CRITERIA, rankApplicants } from "./scorer.js";
import { ShortlistInputError, UnknownApplicantError, updateShortlist } from "./shortlist.js";
import { normalizeLandlordName } from "./store.js";

const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 4_000;
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

function messageProblem(input) {
  const message = isPlainObject(input) ? input.message : undefined;
  if (typeof message === "string" && message.trim() && message.length <= MAX_MESSAGE_LENGTH) return null;
  return {
    field: "message",
    code: "required",
    message: `'message' must be a non-empty string of at most ${MAX_MESSAGE_LENGTH} characters.`,
  };
}

// Without a model, the chat's one answer, as the same events the Landlord Orchestrator yields.
async function* notConfiguredTurn(message) {
  // German unless the message is clearly English, like the Landlord Orchestrator.
  yield { type: "token", text: landlordReply("notConfigured", detectLanguage(message) ?? "de") };
  yield { type: "done" };
}

const EMPTY_POOL = { applicants: [], errors: [] };

const LISTING_REQUIRED = {
  code: "listing_required",
  message: "Save your flat's Listing first: the applicants are ranked for its rent and size.",
};

// The document flags the dashboard shows beside an applicant: each document's status, whether
// the previous landlord confirms rent arrears, and whether the application is complete.
const documentFlagsOf = ({ schufa, incomeProof, previousLandlord, complete }) => ({
  schufa: schufa.status,
  incomeProof: incomeProof.status,
  previousLandlord: previousLandlord.status,
  arrears: previousLandlord.arrears === true,
  complete,
});

// The ranking of the pool for the Listing, its stats and Recommendations (none without a
// Listing), with each applicant's name (and, in the ranking, document flags) joined in for
// display. The scorer sees the anonymised profiles only.
function rankingFor(listing, { applicants }, criteria) {
  if (!listing) return { ranked: [], excluded: [], stats: null, recommendations: [], hint: LISTING_REQUIRED };
  const { ranked, excluded, stats, recommendations } = rankApplicants({
    profiles: applicants.map(({ profile }) => profile),
    listing,
    criteria,
  });
  const applicantsById = new Map(applicants.map((applicant) => [applicant.id, applicant]));
  const nameOf = (applicantId) => applicantsById.get(applicantId).contact.name;
  const forDisplay = (entry) => {
    const { contact, profile } = applicantsById.get(entry.applicantId);
    return { ...entry, name: contact.name, documents: documentFlagsOf(profile.documentCheck) };
  };
  return {
    ranked: ranked.map(forDisplay),
    excluded: excluded.map(forDisplay),
    stats,
    recommendations: recommendations.map((entry) => ({ ...entry, name: nameOf(entry.applicantId) })),
    hint: null,
  };
}

// The Shortlist for display: each entry with the applicant's name and, from the ranking, their
// rank and Match score (null without a Listing or when excluded; `excluded` says which).
function shortlistFor(entries, { applicants }, { ranked, excluded }) {
  const namesById = new Map(applicants.map(({ id, contact }) => [id, contact.name]));
  const rankedById = new Map(ranked.map((entry) => [entry.applicantId, entry]));
  const excludedIds = new Set(excluded.map(({ applicantId }) => applicantId));
  return entries.map(({ applicantId, status, note, added }) => ({
    applicantId,
    name: namesById.get(applicantId) ?? null,
    status,
    note,
    added,
    rank: rankedById.get(applicantId)?.rank ?? null,
    matchScore: rankedById.get(applicantId)?.matchScore ?? null,
    excluded: excludedIds.has(applicantId),
  }));
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
// - getApplicantPool(): the Applicant pool ({ applicants, errors }, see readApplicantPool), or a
//   promise of it; scored for the landlord's Listing on every dashboard request.
// - fetchImpl: the fetch for the Berlin services (default: the global fetch).
// - getChat(): the Landlord Orchestrator (see createLandlordOrchestrator), built on first use; null
//   when no model is configured, and the chat then answers that it is not configured.
// handle(request, response, url) answers a landlord request and returns true, or returns
// false when the request is not a landlord one.
export function createLandlordApi({ getStore, getApplicantPool = () => EMPTY_POOL, fetchImpl, getChat = () => null }) {
  async function readBody(request, response, maxBytes = 16_384) {
    try {
      return { input: await readJson(request, maxBytes, LandlordInputError) };
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

  // GET /api/v1/landlord/:landlordId/dashboard → { listing, rentCheck, criteria, ranked, excluded,
  // stats, recommendations, hint, shortlist, poolErrors }. Criteria are the defaults until they
  // can be tuned.
  async function dashboard(response, landlordId) {
    const listing = getStore().getListing(landlordId);
    const pool = await getApplicantPool();
    const criteria = DEFAULT_CRITERIA;
    const ranking = rankingFor(listing, pool, criteria);
    sendJson(response, 200, {
      data: {
        listing,
        rentCheck: listing?.rentCheck ?? null,
        criteria,
        ...ranking,
        shortlist: shortlistFor(getStore().getShortlist(landlordId), pool, ranking),
        poolErrors: pool.errors,
      },
    });
  }

  // Runs updateShortlist against the pool and answers with the entry, a 422 or a 404.
  async function changeShortlist(response, landlordId, change) {
    const { applicants } = await getApplicantPool();
    const applicantIds = new Set(applicants.map(({ id }) => id));
    try {
      sendJson(response, 200, { data: updateShortlist({ store: getStore(), landlordId, applicantIds, ...change }) });
    } catch (error) {
      if (error instanceof ShortlistInputError) sendError(response, 422, "validation_error", error.message, error.details);
      else if (error instanceof UnknownApplicantError) sendError(response, 404, "applicant_not_found", error.message);
      else throw error;
    }
  }

  // PUT /api/v1/landlord/:landlordId/shortlist/:applicantId { status, note? } → the entry. Removing
  // is DELETE, so 'remove' is not a status here.
  async function putShortlistEntry(request, response, landlordId, applicantId) {
    const body = await readBody(request, response);
    if (!body) return;
    const input = isPlainObject(body.input) ? body.input : {};
    const status = input.status === "remove" ? undefined : input.status;
    await changeShortlist(response, landlordId, { applicantId, status, note: input.note });
  }

  // DELETE /api/v1/landlord/:landlordId/shortlist/:applicantId → { applicantId, status: "removed", note: null }.
  async function deleteShortlistEntry(request, response, landlordId, applicantId) {
    await changeShortlist(response, landlordId, { applicantId, status: "remove" });
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

  // POST /api/v1/landlord/:landlordId/chat { message } → one turn of the Landlord Orchestrator,
  // streamed as SSE (token, criteria, shortlist, done, error).
  async function chat(request, response, landlordId) {
    const body = await readBody(request, response, 64 * 1024);
    if (!body) return;
    const problem = messageProblem(body.input);
    if (problem) {
      sendError(response, 422, "validation_error", problem.message, [problem]);
      return;
    }
    const { message } = body.input;
    const abort = new AbortController();
    await streamEvents(response, chatTurn(landlordId, message, abort.signal), abort);
  }

  async function* chatTurn(landlordId, message, signal) {
    let orchestrator;
    try {
      orchestrator = getChat();
    } catch (error) {
      console.error("The Landlord Orchestrator could not be created:", error.message);
      yield { type: "error", message: "Amt-Buddy's AI chat is not available right now." };
      return;
    }
    if (!orchestrator) yield* notConfiguredTurn(message);
    else yield* orchestrator.send({ landlordId, message, signal });
  }

  const routes = {
    "GET dashboard": (request, response, landlordId) => dashboard(response, landlordId),
    "PUT listing": saveListing,
    "POST chat": chat,
    "PUT shortlist": putShortlistEntry,
    "DELETE shortlist": deleteShortlistEntry,
  };

  return {
    async handle(request, response, url) {
      if (!url.pathname.startsWith(LANDLORD_PATH)) return false;
      const path = url.pathname.slice(LANDLORD_PATH.length);
      if (request.method === "POST" && path === "sessions") {
        await signIn(request, response);
        return true;
      }
      const match = /^([^/]+)\/(dashboard|listing|chat|shortlist)(?:\/([^/]+))?$/.exec(path);
      // Only the Shortlist's paths carry an applicant id.
      const handler = match && (match[2] === "shortlist") === (match[3] !== undefined) && routes[`${request.method} ${match[2]}`];
      if (!handler) {
        sendError(response, 404, "not_found", "No such landlord endpoint.");
        return true;
      }
      const landlordId = decodeId(match[1]);
      if (!landlordId || !getStore().getLandlord(landlordId)) {
        sendError(response, 404, "landlord_not_found", "No landlord with this id. Sign in again.");
        return true;
      }
      const applicantId = match[3] === undefined ? undefined : decodeId(match[3]);
      if (applicantId === null) {
        sendError(response, 404, "applicant_not_found", "No applicant with this id.");
        return true;
      }
      await handler(request, response, landlordId, applicantId);
      return true;
    },
  };
}

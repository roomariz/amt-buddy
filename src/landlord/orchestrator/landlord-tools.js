import { tool } from "@langchain/core/tools";

import { getApplicantProfile } from "../applicant-profile.js";
import { adjustSelectionCriteria, CriteriaInputError, MAX_SHARE, updateSelectionCriteria } from "../criteria.js";
import { flatToRank, missingForListing, updateFlatDetails } from "../flat-details.js";
import { ListingInputError } from "../listing.js";
import { rankApplicants } from "../scorer.js";
import { ShortlistInputError, updateShortlist } from "../shortlist.js";
import { LANDLORD_TOOL_CONTRACTS } from "./tool-contracts.js";

// The real landlord Tools, built on the dashboard's functions (scorer, criteria, flat details,
// applicant profile, Shortlist). Every result names applicants by id only: the Applicant profile
// is the anonymised one, and neither names, contact details nor Shortlist notes are passed on.
// The applicants are ranked for the flat details, a Listing or not: what a missing fact switches
// off is reported as `inactive` (see rankApplicants).

// How many ranked applicants get_ranking shows, and the criteria and flat Tools' "new top".
const RANKING_LIMIT = 10;
const TOP_LIMIT = 3;
// How many ranked applicants the context shows every turn, so follow-up answers stay grounded.
const CONTEXT_TOP_LIMIT = 5;

// Why there is no Rent check while flat facts are missing.
const rentCheckNeeds = (missing) =>
  `The Rent check needs the flat's address (street, house number and postal code), living area, rooms and asking rent; still missing: ${missing.join(", ")}. Ask the landlord for them and save them with update_flat_details.`;

class LandlordToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "LandlordToolInputError";
    this.kind = "input";
  }
}

const oneDecimal = (value) => Math.round(value * 10) / 10;

// Weights to one decimal, so the chat can quote them ("from 15 % to 26.1 %") and stay grounded.
const roundedCriteria = ({ weights, requirements }) => ({
  weights: Object.fromEntries(Object.entries(weights).map(([criterion, weight]) => [criterion, oneDecimal(weight)])),
  requirements,
});

// The points each criterion adds to the Match score: subscore × weight (% of the Match score), to
// one decimal; null for an inactive criterion. Computed here from the scorer's breakdown (ADR 0004),
// so the chat compares applicants by points rather than by subscores whose weights differ. They sum
// to the Match score up to rounding.
const contributionsOf = (breakdown) =>
  Object.fromEntries(Object.entries(breakdown).map(([criterion, { subscore, weight }]) => [criterion, subscore === null ? null : oneDecimal(subscore * weight)]));

// A ranked applicant as the model sees it.
const rankedEntry = ({ applicantId, rank, matchScore, rentToIncome, breakdown }) => ({ applicantId, rank, matchScore, rentToIncome, breakdown });

// The Shortlist by id and status; notes are the landlord's free text and may name people.
const shortlistEntries = (store, landlordId) => store.getShortlist(landlordId).map(({ applicantId, status }) => ({ applicantId, status }));

// The pool ranked for the flat under the criteria (rankApplicants on the anonymised profiles).
const rankPool = ({ applicants, flat, criteria }) =>
  rankApplicants({ profiles: applicants.map(({ profile }) => profile), listing: flat, criteria });

// A dashboard function's input error (CriteriaInputError, ShortlistInputError, ListingInputError)
// as a Tool input error, with its details in the message the model reads; `addendum` follows them.
// An error whose message is one of its details' (ListingInputError) is not said twice.
function asToolInputError(error, addendum = "") {
  const details = error.details ?? [];
  const listed = details.map(({ field, message }) => `${field}: ${message}`).join("; ");
  const repeated = details.some(({ message }) => message === error.message);
  const message = !listed ? error.message : repeated ? listed : `${error.message} ${listed}`;
  return new LandlordToolInputError(addendum ? `${message} ${addendum}` : message);
}

// A Tool's list of changes ([{ <key>, value }], naming only what changes) as the object the
// dashboard function takes. A name listed twice is refused: which value was meant is unclear.
function namedValues(entries, key) {
  const values = {};
  for (const { [key]: name, value } of entries) {
    if (Object.hasOwn(values, name)) throw new LandlordToolInputError(`'${name}' is listed more than once: list it once. Nothing was saved.`);
    values[name] = value;
  }
  return values;
}

// A criteria change's result: the old and new criteria to one decimal, the new top 3 and what is
// inactive.
function criteriaResult({ previous, criteria }, state) {
  const { ranked, inactive } = rankPool(state);
  return {
    previous: roundedCriteria(previous),
    criteria: roundedCriteria(criteria),
    top: ranked.slice(0, TOP_LIMIT).map(rankedEntry),
    inactive,
  };
}

// The Listing's official facts as the model sees them (no coordinates).
const listingFacts = ({ addressVerified, canonicalAddress, residentialLocation, buildingAgePeriod }) => ({
  addressVerified,
  canonicalAddress: canonicalAddress && (({ coordinates, ...address }) => address)(canonicalAddress),
  residentialLocation,
  buildingAgePeriod,
});

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries) counts[entry[key]] = (counts[entry[key]] ?? 0) + 1;
  return counts;
}

// createLandlordTools({ getStore, getApplicantPool, fetchImpl }) → { tools }
// - getStore(): the landlord store (see createLandlordStore).
// - getApplicantPool(): the Applicant pool ({ applicants, errors }), or a promise of it.
// - fetchImpl: the fetch for the Berlin services update_flat_details uses (default: global fetch).
// Each Tool reads the landlord from config.configurable.landlordId.
export function createLandlordTools({ getStore, getApplicantPool, fetchImpl }) {
  async function landlordState(landlordId) {
    const store = getStore();
    const { applicants } = await getApplicantPool();
    return { store, applicants, flat: flatToRank(store, landlordId), criteria: store.getCriteria(landlordId) };
  }

  const handlers = {
    async get_ranking(args, landlordId) {
      const state = await landlordState(landlordId);
      const { ranked, excluded, stats, inactive } = rankPool(state);
      return {
        criteria: roundedCriteria(state.criteria),
        stats,
        rankedCount: ranked.length,
        ranked: ranked.slice(0, RANKING_LIMIT).map(rankedEntry),
        excludedByReason: countBy(excluded, "excludedBy"),
        shortlist: shortlistEntries(state.store, landlordId),
        inactive,
      };
    },

    async get_applicant_profile({ applicantId }, landlordId) {
      const state = await landlordState(landlordId);
      const { store, applicants, flat, criteria } = state;
      const found = getApplicantProfile({ applicants, listing: flat, applicantId, criteria });
      if (!found) throw new LandlordToolInputError(`There is no applicant '${applicantId}' in the Applicant pool.`);
      const { profile, score, rentToIncome } = found;
      const shortlisted = store.getShortlist(landlordId).find((entry) => entry.applicantId === applicantId);
      return {
        profile,
        rank: score?.rank ?? null,
        matchScore: score?.matchScore ?? null,
        breakdown: score?.breakdown ?? null,
        contributions: score?.breakdown ? contributionsOf(score.breakdown) : null,
        rentToIncome,
        excludedBy: score?.excludedBy ?? null,
        exclusionReasons: score?.reasons ?? [],
        shortlistStatus: shortlisted?.status ?? null,
        inactive: rankPool(state).inactive,
      };
    },

    // Requirements only: the contract has no weights, so the model changes them only through
    // adjust_selection_criteria and its limits. Each value is checked by updateSelectionCriteria.
    async update_selection_criteria({ changes }, landlordId) {
      const requirements = namedValues(changes, "requirement");
      let updated;
      try {
        updated = updateSelectionCriteria({ store: getStore(), landlordId, input: { requirements } });
      } catch (error) {
        throw error instanceof CriteriaInputError ? asToolInputError(error) : error;
      }
      return criteriaResult(updated, await landlordState(landlordId));
    },

    async adjust_selection_criteria({ changes }, landlordId) {
      let adjusted;
      try {
        adjusted = adjustSelectionCriteria({ store: getStore(), landlordId, changes });
      } catch (error) {
        throw error instanceof CriteriaInputError ? asToolInputError(error) : error;
      }
      const applied = adjusted.applied.map(({ criterion, from, requested, to, capped }) => ({
        criterion,
        from: oneDecimal(from),
        requested: oneDecimal(requested),
        to: oneDecimal(to),
        capped,
      }));
      const { previous, criteria, top, inactive } = criteriaResult(adjusted, await landlordState(landlordId));
      // maxShare: the limit, so that the chat can quote it and stay grounded.
      return { previous, criteria, applied, maxShare: MAX_SHARE, top, inactive };
    },

    async update_flat_details({ facts }, landlordId) {
      const input = namedValues(facts, "fact");
      let updated;
      try {
        updated = await updateFlatDetails({ store: getStore(), landlordId, input, fetchImpl });
      } catch (error) {
        if (!(error instanceof ListingInputError)) throw error;
        throw asToolInputError(error, "Nothing was saved: call again without that value to save the others.");
      }
      const { flat, missing, listing } = updated;
      const state = await landlordState(landlordId);
      const { ranked, stats, inactive } = rankPool(state);
      return {
        flat,
        missing,
        listing: listing && listingFacts(listing),
        rentCheck: listing?.rentCheck ?? null,
        note: listing ? (listing.rentCheck ? null : (listing.note?.message ?? null)) : rentCheckNeeds(missing),
        stats,
        top: ranked.slice(0, TOP_LIMIT).map(rankedEntry),
        inactive,
      };
    },

    async remember_preference({ note }, landlordId) {
      const text = note.trim();
      if (!text) throw new LandlordToolInputError("The note is empty: say in a few words what the landlord prefers.");
      const { noteId, note: saved } = getStore().addNote(landlordId, text);
      return { noteId, note: saved };
    },

    // The chat never clears a note: a model fills an unused note with null or "", and the note is
    // the landlord's free text, which it has not seen. So null or blank keeps the entry's note.
    async update_shortlist({ applicantId, status, note: given }, landlordId) {
      const note = given?.trim() ? given : undefined;
      const { applicants } = await getApplicantPool();
      const applicantIds = new Set(applicants.map(({ id }) => id));
      let entry;
      try {
        entry = updateShortlist({ store: getStore(), landlordId, applicantIds, applicantId, status, note });
      } catch (error) {
        throw error instanceof ShortlistInputError ? asToolInputError(error) : error;
      }
      // A note the model did not write this call is the landlord's free text: it stays unseen.
      return { ...entry, note: note === undefined ? null : entry.note };
    },

    async get_rent_check(args, landlordId) {
      const store = getStore();
      const listing = store.getListing(landlordId);
      if (!listing) {
        const missing = missingForListing(store.getFlatDetails(landlordId));
        return { rentCheck: null, note: rentCheckNeeds(missing), missing };
      }
      return { rentCheck: listing.rentCheck ?? null, note: listing.rentCheck ? null : (listing.note?.message ?? null) };
    },
  };

  const tools = Object.values(LANDLORD_TOOL_CONTRACTS).map((contract) =>
    tool(
      async (args, config) => {
        const landlordId = config?.configurable?.landlordId;
        if (!landlordId) throw new Error(`${contract.name} needs the landlord (config.configurable.landlordId).`);
        return handlers[contract.name](args, landlordId);
      },
      { name: contract.name, description: contract.description, schema: contract.schema },
    ),
  );
  return { tools };
}

// createLandlordContext({ getStore, getApplicantPool }) → getContext(landlordId) for the Landlord
// Orchestrator: what its system prompt shows every turn, loaded from the store so it outlives the
// chat thread (the long-term memory): the Landlord preferences (saved Selection criteria and the
// remembered notes), the Listing (with its Rent check; null before one is built), the flat details
// with what the Listing still needs, the pool stats and inactive items under those criteria, the
// top of the ranking (the one get_ranking gives, without breakdowns) and the Shortlist, so the
// model can quote them in a follow-up without calling get_ranking and stay grounded.
export function createLandlordContext({ getStore, getApplicantPool }) {
  return async (landlordId) => {
    const store = getStore();
    const criteria = store.getCriteria(landlordId);
    const preferences = {
      criteria: roundedCriteria(criteria),
      notes: store.listNotes(landlordId).map(({ note, created }) => ({ note, created: created.slice(0, 10) })),
    };
    const flat = store.getFlatDetails(landlordId);
    const { applicants } = await getApplicantPool();
    const { ranked, stats, inactive } = rankPool({ applicants, flat: flatToRank(store, landlordId), criteria });
    const top = ranked.slice(0, CONTEXT_TOP_LIMIT).map(({ applicantId, rank, matchScore, rentToIncome }) => ({ applicantId, rank, matchScore, rentToIncome }));
    const shortlist = shortlistEntries(store, landlordId);
    return { listing: store.getListing(landlordId), flat, missing: missingForListing(flat), inactive, preferences, stats, top, shortlist };
  };
}

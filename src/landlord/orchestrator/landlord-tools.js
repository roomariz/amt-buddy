import { tool } from "@langchain/core/tools";

import { getApplicantProfile } from "../applicant-profile.js";
import { CriteriaInputError, updateSelectionCriteria } from "../criteria.js";
import { rankApplicants } from "../scorer.js";
import { ShortlistInputError, updateShortlist } from "../shortlist.js";
import { LANDLORD_STUB_HANDLERS } from "./stub-tools.js";
import { LANDLORD_TOOL_CONTRACTS } from "./tool-contracts.js";

// The real landlord Tools, built on the dashboard's functions (scorer, criteria, applicant
// profile, Shortlist). Every result names applicants by id only: the Applicant profile is the
// anonymised one, and neither names, contact details nor Shortlist notes are passed on.
// remember_preference stays a stub until the Landlord preferences are stored (#47).

// How many ranked applicants get_ranking shows, and update_selection_criteria's "new top".
const RANKING_LIMIT = 10;
const TOP_LIMIT = 3;

const LISTING_REQUIRED =
  "The landlord has not saved a Listing yet: the applicants are ranked for its rent and size. Ask them to save it on the page first.";

class LandlordToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "LandlordToolInputError";
    this.kind = "input";
  }
}

// Weights to one decimal, so the chat can quote them ("from 15 % to 26.1 %") and stay grounded.
const roundedCriteria = ({ weights, requirements }) => ({
  weights: Object.fromEntries(Object.entries(weights).map(([criterion, weight]) => [criterion, Math.round(weight * 10) / 10])),
  requirements,
});

// A ranked applicant as the model sees it.
const rankedEntry = ({ applicantId, rank, matchScore, rentToIncome, breakdown }) => ({ applicantId, rank, matchScore, rentToIncome, breakdown });

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries) counts[entry[key]] = (counts[entry[key]] ?? 0) + 1;
  return counts;
}

// createLandlordTools({ getStore, getApplicantPool }) → { tools }
// - getStore(): the landlord store (see createLandlordStore).
// - getApplicantPool(): the Applicant pool ({ applicants, errors }), or a promise of it.
// Each Tool reads the landlord from config.configurable.landlordId.
export function createLandlordTools({ getStore, getApplicantPool }) {
  async function stateOf(landlordId) {
    const store = getStore();
    const { applicants } = await getApplicantPool();
    return { store, applicants, listing: store.getListing(landlordId), criteria: store.getCriteria(landlordId) };
  }

  const rank = ({ applicants, listing, criteria }) =>
    rankApplicants({ profiles: applicants.map(({ profile }) => profile), listing, criteria });

  const handlers = {
    async get_ranking(args, landlordId) {
      const state = await stateOf(landlordId);
      if (!state.listing) throw new LandlordToolInputError(LISTING_REQUIRED);
      const { ranked, excluded, stats } = rank(state);
      return {
        criteria: roundedCriteria(state.criteria),
        stats,
        rankedCount: ranked.length,
        ranked: ranked.slice(0, RANKING_LIMIT).map(rankedEntry),
        excludedByReason: countBy(excluded, "excludedBy"),
        // The Shortlist by id and status; notes are the landlord's free text and may name people.
        shortlist: state.store.getShortlist(landlordId).map(({ applicantId, status }) => ({ applicantId, status })),
      };
    },

    async get_applicant_profile({ applicantId }, landlordId) {
      const { store, applicants, listing, criteria } = await stateOf(landlordId);
      const found = getApplicantProfile({ applicants, listing, applicantId, criteria });
      if (!found) throw new LandlordToolInputError(`There is no applicant '${applicantId}' in the Applicant pool.`);
      const { profile, score, rentToIncome } = found;
      const shortlisted = store.getShortlist(landlordId).find((entry) => entry.applicantId === applicantId);
      return {
        profile,
        rank: score?.rank ?? null,
        matchScore: score?.matchScore ?? null,
        breakdown: score?.breakdown ?? null,
        rentToIncome,
        excludedBy: score?.excludedBy ?? null,
        exclusionReasons: score?.reasons ?? [],
        shortlistStatus: shortlisted?.status ?? null,
        ...(!listing && { note: LISTING_REQUIRED }),
      };
    },

    async update_selection_criteria({ weights, requirements }, landlordId) {
      const store = getStore();
      let updated;
      try {
        updated = updateSelectionCriteria({ store, landlordId, input: { weights, requirements } });
      } catch (error) {
        if (!(error instanceof CriteriaInputError)) throw error;
        throw new LandlordToolInputError(`${error.message} ${error.details.map(({ field, message }) => `${field}: ${message}`).join("; ")}`);
      }
      const state = await stateOf(landlordId);
      const top = state.listing ? rank(state).ranked.slice(0, TOP_LIMIT).map(rankedEntry) : [];
      return { previous: roundedCriteria(updated.previous), criteria: roundedCriteria(updated.criteria), top };
    },

    remember_preference: (args) => LANDLORD_STUB_HANDLERS.remember_preference(args),

    async update_shortlist({ applicantId, status, note }, landlordId) {
      const { applicants } = await getApplicantPool();
      const applicantIds = new Set(applicants.map(({ id }) => id));
      try {
        return updateShortlist({ store: getStore(), landlordId, applicantIds, applicantId, status, note });
      } catch (error) {
        if (error instanceof ShortlistInputError) throw new LandlordToolInputError(error.message);
        throw error;
      }
    },

    async get_rent_check(args, landlordId) {
      const listing = getStore().getListing(landlordId);
      if (!listing) return { rentCheck: null, note: LISTING_REQUIRED };
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

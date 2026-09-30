import { tool } from "@langchain/core/tools";

import { getApplicantProfile } from "../applicant-profile.js";
import { adjustSelectionCriteria, CriteriaInputError, MAX_SHARE, updateSelectionCriteria } from "../criteria.js";
import { flatToRank, missingForListing, updateFlatDetails } from "../flat-details.js";
import { ListingInputError } from "../listing.js";
import { adjustBonusPoints, BonusInputError, ratingsOf } from "../ratings.js";
import { excludedByReason, MAX_BONUS_POINTS, rankApplicants } from "../scorer.js";
import { ShortlistInputError, updateShortlist } from "../shortlist.js";
import { LANDLORD_TOOL_CONTRACTS } from "./tool-contracts.js";

// The real landlord Tools, built on the dashboard's functions (scorer, criteria, flat details,
// applicant profile, Shortlist, ratings). Every result names applicants by id only: the Applicant
// profile is the anonymised one, and neither names, contact details nor Shortlist notes are passed
// on. The landlord's ratings reach the model only as a rated applicant's bonus in points (+N / −N)
// and ranking score (Match score + bonus), computed here (ADR 0004), never as "up" or "down".
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

// The criteria adjust_selection_criteria did not name, and the factor their saved shares were all
// scaled by to fill the rest to 100 % (new share / saved share, to three decimals: 74 / 80 → 0.925;
// above 1 when they grew). null when there is nothing to scale: every criterion named, or the
// others all at 0 %.
function othersScaled({ previous, applied }) {
  const named = new Set(applied.map(({ criterion }) => criterion));
  const criteria = Object.keys(previous.weights).filter((criterion) => !named.has(criterion));
  const savedTotal = Object.values(previous.weights).reduce((total, weight) => total + weight, 0);
  const rest = criteria.reduce((total, criterion) => total + (previous.weights[criterion] / savedTotal) * 100, 0);
  const left = 100 - applied.reduce((total, { to }) => total + to, 0);
  return { factor: rest > 0 ? Math.round((left / rest) * 1000) / 1000 : null, criteria };
}

// The points each criterion adds to the Match score: subscore × weight (% of the Match score), to
// one decimal; null for an inactive criterion. Computed here from the scorer's breakdown (ADR 0004),
// so the chat compares applicants by points rather than by subscores whose weights differ. They sum
// to the Match score up to rounding.
const contributionsOf = (breakdown) =>
  Object.fromEntries(Object.entries(breakdown).map(([criterion, { subscore, weight }]) => [criterion, subscore === null ? null : oneDecimal(subscore * weight)]));

// Criteria whose points differ by less than this are equal for the two applicants.
const EQUAL_POINTS = 0.05;

// A ranked entry's ranking score: Match score + the bonus of the landlord's rating (both one decimal).
const rankingScoreOf = ({ matchScore, bonus = 0 }) => oneDecimal(matchScore + bonus);

// A rated applicant's bonus and ranking score, as the model sees them; nothing for an unrated one.
const bonusOf = (entry) => (entry.bonus === undefined ? {} : { bonus: entry.bonus, rankingScore: rankingScoreOf(entry) });

// compare_applicants' result for two applicant ids in a ranking ({ ranked, excluded, rankingScores }
// of rankApplicants): each one's rank and Match score, or the Requirement that excluded them; when
// both are ranked, the leader, the Match score gap (first − second) and per active criterion both
// applicants' points (the contributions) with their difference (first − second), largest first.
// When the landlord rated either of them, the bonus is one more line ("bonus", in the differences
// or the equal ones), each applicant has bonus and rankingScore, the leader is by ranking score and
// rankingGap is its gap (first − second); scoreGap stays the Match score gap. Unrated, none of these
// fields appear.
// The leader is the one ranked higher, and a tie (no leader, ordered by applicant id) only when the
// unrounded scores the ranking is sorted by are equal: scores equal to one decimal are not a tie,
// and the note says so, since the prompt has the model say "ordered by applicant id" for equal ones.
// Computed here (ADR 0004): a live model given both contributions misread which criteria differed.
// Throws a Tool input error for an id that is not in the pool.
export function compareApplicants({ ranked, excluded, rankingScores }, [first, second]) {
  const entryOf = (id) => {
    const entry = ranked.find(({ applicantId }) => applicantId === id) ?? excluded.find(({ applicantId }) => applicantId === id);
    if (!entry) throw new LandlordToolInputError(`There is no applicant '${id}' in the Applicant pool.`);
    return entry;
  };
  const entries = [entryOf(first), entryOf(second)];
  // Only a ranked applicant has a bonus: an excluded one is not compared.
  const rated = entries.some(({ bonus }) => bonus !== undefined) && entries.every(({ excludedBy }) => !excludedBy);
  const applicants = entries.map((entry) => ({
    applicantId: entry.applicantId,
    rank: entry.rank ?? null,
    matchScore: entry.matchScore ?? null,
    excludedBy: entry.excludedBy ?? null,
    ...(rated && { bonus: entry.bonus ?? 0, rankingScore: rankingScoreOf(entry) }),
  }));
  const out = entries.filter(({ excludedBy }) => excludedBy);
  if (out.length > 0) {
    const which = out.map(({ applicantId, excludedBy }) => `${applicantId} is excluded by the Requirement ${excludedBy}`).join("; ");
    return { applicants, leader: null, scoreGap: null, differences: [], equal: [], note: `${which}: an excluded applicant has no Match score, so there are no points to compare.` };
  }
  const [a, b] = entries.map(({ breakdown }) => contributionsOf(breakdown));
  const differences = [];
  const equal = [];
  for (const criterion of Object.keys(a)) {
    // An inactive criterion counts for neither.
    if (a[criterion] === null || b[criterion] === null) continue;
    const difference = oneDecimal(a[criterion] - b[criterion]);
    if (Math.abs(difference) < EQUAL_POINTS) equal.push(criterion);
    else differences.push({ criterion, points: { [first]: a[criterion], [second]: b[criterion] }, difference });
  }
  if (rated) {
    const [bonusA, bonusB] = applicants.map(({ bonus }) => bonus);
    const difference = oneDecimal(bonusA - bonusB);
    if (Math.abs(difference) < EQUAL_POINTS) equal.push("bonus");
    else differences.push({ criterion: "bonus", points: { [first]: bonusA, [second]: bonusB }, difference });
  }
  differences.sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference));
  const [scoreA, scoreB] = entries.map(({ matchScore }) => matchScore);
  const [rankingA, rankingB] = entries.map(rankingScoreOf);
  const tie = rankingScores.get(first) === rankingScores.get(second);
  const leader = tie ? null : entries[0].rank < entries[1].rank ? first : second;
  const scores = rated ? "ranking scores (Match score + bonus)" : "Match scores";
  return {
    applicants,
    leader,
    scoreGap: oneDecimal(scoreA - scoreB),
    ...(rated && { rankingGap: oneDecimal(rankingA - rankingB) }),
    differences,
    equal,
    note: tie
      ? `equal ${scores}; ordered by applicant id`
      : rankingA === rankingB
        ? `equal ${scores} to one decimal, but ${leader}'s is higher unrounded, so ${leader} ranks higher; not ordered by applicant id`
        : null,
  };
}

// A ranked applicant as the model sees it.
const rankedEntry = (entry) => {
  const { applicantId, rank, matchScore, rentToIncome, breakdown } = entry;
  return { applicantId, rank, matchScore, rentToIncome, breakdown, ...bonusOf(entry) };
};

// The Shortlist by id and status; notes are the landlord's free text and may name people.
const shortlistEntries = (store, landlordId) => store.getShortlist(landlordId).map(({ applicantId, status }) => ({ applicantId, status }));

// The pool ranked for the flat under the criteria, with the landlord's ratings (rankApplicants on
// the anonymised profiles).
const rankPool = ({ applicants, flat, criteria, ratings, bonusPoints }) =>
  rankApplicants({ profiles: applicants.map(({ profile }) => profile), listing: flat, criteria, ratings, bonusPoints });

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

// createLandlordTools({ getStore, getApplicantPool, fetchImpl }) → { tools }
// - getStore(): the landlord store (see createLandlordStore).
// - getApplicantPool(): the Applicant pool ({ applicants, errors }), or a promise of it.
// - fetchImpl: the fetch for the Berlin services update_flat_details uses (default: global fetch).
// Each Tool reads the landlord from config.configurable.landlordId.
export function createLandlordTools({ getStore, getApplicantPool, fetchImpl }) {
  async function landlordState(landlordId) {
    const store = getStore();
    const { applicants } = await getApplicantPool();
    return { store, applicants, flat: flatToRank(store, landlordId), criteria: store.getCriteria(landlordId), ...ratingsOf(store, landlordId) };
  }

  const handlers = {
    async get_ranking(args, landlordId) {
      const state = await landlordState(landlordId);
      const { ranked, excluded, stats, inactive } = rankPool(state);
      return {
        criteria: roundedCriteria(state.criteria),
        bonusPoints: state.bonusPoints,
        stats,
        rankedCount: ranked.length,
        ranked: ranked.slice(0, RANKING_LIMIT).map(rankedEntry),
        excludedByReason: excludedByReason(excluded),
        shortlist: shortlistEntries(state.store, landlordId),
        inactive,
      };
    },

    async get_applicant_profile({ applicantId }, landlordId) {
      const state = await landlordState(landlordId);
      const { store, applicants, flat, criteria, ratings, bonusPoints } = state;
      const ranking = rankPool(state);
      const found = getApplicantProfile({ applicants, listing: flat, applicantId, criteria, ratings, bonusPoints, ranking });
      if (!found) throw new LandlordToolInputError(`There is no applicant '${applicantId}' in the Applicant pool.`);
      const { profile, score, rentToIncome } = found;
      const shortlisted = store.getShortlist(landlordId).find((entry) => entry.applicantId === applicantId);
      return {
        profile,
        rank: score?.rank ?? null,
        matchScore: score?.matchScore ?? null,
        breakdown: score?.breakdown ?? null,
        contributions: score?.breakdown ? contributionsOf(score.breakdown) : null,
        // Ranked: the bonus of the landlord's rating (0 unrated) and Match score + bonus.
        bonus: score?.breakdown ? (score.bonus ?? 0) : null,
        rankingScore: score?.breakdown ? rankingScoreOf(score) : null,
        rentToIncome,
        excludedBy: score?.excludedBy ?? null,
        exclusionReasons: score?.reasons ?? [],
        shortlistStatus: shortlisted?.status ?? null,
        inactive: ranking.inactive,
      };
    },

    async compare_applicants({ applicantIds }, landlordId) {
      return compareApplicants(rankPool(await landlordState(landlordId)), applicantIds);
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
        // The relative change asked for, in % of the old share (× 1.3 → 30): a live model said
        // "30 % more" and the grounding check stripped it, since the factor was only in its own call.
        requestedChange: from > 0 ? Math.round((requested / from - 1) * 100) : null,
      }));
      const { top, inactive } = criteriaResult(adjusted, await landlordState(landlordId));
      // No full weight lists: given them, a live model recited all six shares after every change,
      // while the page's chart already shows them (get_ranking still has them). maxShare: the
      // limit, so that the chat can quote it and stay grounded.
      return { applied, othersScaled: othersScaled(adjusted), maxShare: MAX_SHARE, top, inactive };
    },

    // What a thumbs up / down is worth; the model never rates applicants itself.
    async set_bonus_points({ by, value }, landlordId) {
      let adjusted;
      try {
        adjusted = adjustBonusPoints({ store: getStore(), landlordId, by, value });
      } catch (error) {
        throw error instanceof BonusInputError ? new LandlordToolInputError(`${error.message} Nothing was saved.`) : error;
      }
      const { ranked } = rankPool(await landlordState(landlordId));
      // maxBonusPoints: the limit, so that the chat can quote it and stay grounded.
      return { ...adjusted, maxBonusPoints: MAX_BONUS_POINTS, top: ranked.slice(0, TOP_LIMIT).map(rankedEntry) };
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
// top of the ranking (the one get_ranking gives, without breakdowns; a rated applicant with their
// bonus and ranking score), the bonus points and the Shortlist, so the model can quote them in a
// follow-up without calling get_ranking and stay grounded.
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
    const { ratings, bonusPoints } = ratingsOf(store, landlordId);
    const { ranked, stats, inactive } = rankPool({ applicants, flat: flatToRank(store, landlordId), criteria, ratings, bonusPoints });
    const top = ranked.slice(0, CONTEXT_TOP_LIMIT).map((entry) => {
      const { applicantId, rank, matchScore, rentToIncome } = entry;
      return { applicantId, rank, matchScore, rentToIncome, ...bonusOf(entry) };
    });
    const shortlist = shortlistEntries(store, landlordId);
    return { listing: store.getListing(landlordId), flat, missing: missingForListing(flat), inactive, preferences, stats, bonusPoints, top, shortlist };
  };
}

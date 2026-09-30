// The Scorer: ranks the Applicant profiles for the Landlord's Listing under the Selection
// criteria. Pure and deterministic: code computes every score, the model only explains them and
// edits the criteria (ADR 0004).

import { assessOccupancy } from "../occupancy-assessment.js";
import { COMPLETE_STATUSES, DOCUMENT_HEADINGS } from "./applicant-pool.js";
import { recommendationReasons } from "./recommendation-reasons.js";

// The default Selection criteria: relative weights per criterion and the Requirements (all off
// except occupancyCompliant).
export const DEFAULT_CRITERIA = Object.freeze({
  weights: Object.freeze({ affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 }),
  requirements: Object.freeze({
    schufaCleanOnly: false,
    completeDocumentsOnly: false,
    maxRentToIncome: null,
    noPets: false,
    noSmoking: false,
    latestMoveIn: null,
    occupancyCompliant: true,
  }),
});

const CRITERIA = Object.keys(DEFAULT_CRITERIA.weights);

// Affordability: full marks at or below this rent-to-income ratio, zero at or above the other.
const AFFORDABLE_RATIO = 0.25;
const UNAFFORDABLE_RATIO = 0.4;

const round = (value, digits) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;

function affordabilityOf(rentToIncome) {
  if (rentToIncome <= AFFORDABLE_RATIO) return 1;
  if (rentToIncome >= UNAFFORDABLE_RATIO) return 0;
  return (UNAFFORDABLE_RATIO - rentToIncome) / (UNAFFORDABLE_RATIO - AFFORDABLE_RATIO);
}

const SCHUFA_SUBSCORES = { clean: 1, minor_entries: 0.5, negative: 0, missing: 0 };

const EMPLOYMENT_SUBSCORES = {
  permanent: 1,
  civil_servant: 1,
  fixed_term: 0.6,
  self_employed: 0.6,
  student_with_guarantor: 0.5,
  other: 0.3,
};

// The share of the required Application documents that are present and valid. A document that is
// not required (a first-time renter's previous-landlord confirmation) does not count.
function documentsOf({ schufa, incomeProof, previousLandlord }) {
  const required = [schufa, incomeProof, previousLandlord].filter(({ status }) => status !== "not_required");
  return required.filter(({ status }) => status === "present").length / required.length;
}

// Confirmation without arrears 1, first-time renter 0.5, arrears 0; a confirmation that is missing
// or unusable (another person's name, unreadable) 0.3.
function previousLandlordOf({ status, arrears }) {
  if (status === "not_required") return 0.5;
  if (status === "present") return arrears ? 0 : 1;
  return 0.3;
}

// Each criterion's subscore (0–1) of one profile; affordability null without an asking rent.
function subscoresOf(profile, rentToIncome) {
  return {
    affordability: rentToIncome === null ? null : affordabilityOf(rentToIncome),
    schufa: SCHUFA_SUBSCORES[profile.schufaStatus] ?? 0,
    documents: documentsOf(profile.documentCheck),
    credibility: profile.credibilityScore / 100,
    employment: EMPLOYMENT_SUBSCORES[profile.employmentType] ?? EMPLOYMENT_SUBSCORES.other,
    previousLandlord: previousLandlordOf(profile.documentCheck.previousLandlord),
  };
}

// The weights, the defaults filling in what is left out, normalised to sum to 1. Throws a
// TypeError for a weight that is not a non-negative number, or when all are zero.
function sharesOf(weights = {}) {
  const merged = { ...DEFAULT_CRITERIA.weights, ...weights };
  for (const criterion of CRITERIA) {
    const weight = merged[criterion];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      throw new TypeError(`The weight of '${criterion}' must be a non-negative number, got ${weight}.`);
    }
  }
  const total = CRITERIA.reduce((sum, criterion) => sum + merged[criterion], 0);
  if (total === 0) throw new TypeError("At least one criterion needs a weight above zero.");
  return Object.fromEntries(CRITERIA.map((criterion) => [criterion, merged[criterion] / total]));
}

const isMissing = (value) => value === null || value === undefined;

// What the flat facts still missing switch off: [{ criterion | requirement, missing: [field] }].
// Without the asking rent, affordability and (when set) the maxRentToIncome Requirement; without
// the size or the rooms, the occupancyCompliant Requirement (when on). A Requirement that is off
// is not listed.
function inactiveOf(listing, requirements) {
  const missing = (fields) => fields.filter((field) => isMissing(listing[field]));
  const inactive = [];
  const noRent = missing(["askingRent"]);
  if (noRent.length > 0) inactive.push({ criterion: "affordability", missing: noRent });
  if (noRent.length > 0 && requirements.maxRentToIncome !== null) inactive.push({ requirement: "maxRentToIncome", missing: noRent });
  const noSize = missing(["livingAreaSqm", "rooms"]);
  if (noSize.length > 0 && requirements.occupancyCompliant) inactive.push({ requirement: "occupancyCompliant", missing: noSize });
  return inactive;
}

// The shares with the inactive criteria at 0 and the active ones renormalised to sum to 1 (all 0
// when only inactive criteria carry weight). Nothing inactive: the shares as they are.
function activeSharesOf(shares, inactive) {
  const off = new Set(inactive.map(({ criterion }) => criterion).filter(Boolean));
  if (off.size === 0) return shares;
  const total = CRITERIA.reduce((sum, criterion) => sum + (off.has(criterion) ? 0 : shares[criterion]), 0);
  return Object.fromEntries(CRITERIA.map((criterion) => [criterion, off.has(criterion) || total === 0 ? 0 : shares[criterion] / total]));
}

const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

// What each Requirement's value must be.
const REQUIREMENT_VALUES = {
  schufaCleanOnly: [(value) => typeof value === "boolean", "true or false"],
  completeDocumentsOnly: [(value) => typeof value === "boolean", "true or false"],
  maxRentToIncome: [(value) => value === null || (typeof value === "number" && value > 0 && value <= 1), "null or a ratio above 0 and at most 1"],
  noPets: [(value) => typeof value === "boolean", "true or false"],
  noSmoking: [(value) => typeof value === "boolean", "true or false"],
  latestMoveIn: [(value) => value === null || isDay(value), "null or a day YYYY-MM-DD"],
  occupancyCompliant: [(value) => typeof value === "boolean", "true or false"],
};

// The Requirements, the defaults filling in what is left out. Throws a TypeError for a value of
// the wrong kind.
function requirementsOf(requirements = {}) {
  const merged = { ...DEFAULT_CRITERIA.requirements, ...requirements };
  for (const [requirement, [isValid, expected]] of Object.entries(REQUIREMENT_VALUES)) {
    if (!isValid(merged[requirement])) {
      throw new TypeError(`The requirement '${requirement}' must be ${expected}, got ${merged[requirement]}.`);
    }
  }
  return merged;
}

const DOCUMENTS = Object.keys(DOCUMENT_HEADINGS);
const percent = (ratio) => `${round(ratio * 100, 1)} %`;

// Every Requirement the profile fails, in the order of DEFAULT_CRITERIA.requirements:
// [{ requirement, message, …the values behind it }].
function failedRequirements(profile, rentToIncome, listing, requirements) {
  const reasons = [];
  const fail = (requirement, message, values = {}) => reasons.push({ requirement, message, ...values });
  const { documentCheck } = profile;
  if (requirements.schufaCleanOnly && profile.schufaStatus !== "clean") {
    fail("schufaCleanOnly", `The SCHUFA status is ${profile.schufaStatus}, not clean.`, { schufaStatus: profile.schufaStatus });
  }
  if (requirements.completeDocumentsOnly && !documentCheck.complete) {
    const documents = DOCUMENTS.filter((document) => !COMPLETE_STATUSES.has(documentCheck[document].status));
    fail("completeDocumentsOnly", `The documents are incomplete: ${documents.join(", ")}.`, { documents });
  }
  if (requirements.maxRentToIncome !== null && rentToIncome > requirements.maxRentToIncome) {
    fail("maxRentToIncome", `The rent is ${percent(rentToIncome)} of the net household income, above ${percent(requirements.maxRentToIncome)}.`, {
      rentToIncome: round(rentToIncome, 4),
      limit: requirements.maxRentToIncome,
    });
  }
  if (requirements.noPets && profile.pets) fail("noPets", "The household has pets.");
  if (requirements.noSmoking && profile.smoking) fail("noSmoking", "The household smokes.");
  if (requirements.latestMoveIn !== null && profile.moveInDate > requirements.latestMoveIn) {
    fail("latestMoveIn", `The move-in date ${profile.moveInDate} is after ${requirements.latestMoveIn}.`, {
      moveInDate: profile.moveInDate,
      limit: requirements.latestMoveIn,
    });
  }
  if (requirements.occupancyCompliant) {
    const occupancy = assessOccupancy({
      livingAreaSqm: listing.livingAreaSqm,
      rooms: listing.rooms,
      occupants: profile.householdSize,
      childrenUpToSix: profile.household.childrenUpToSix,
    });
    if (occupancy.status === "below_minimum") {
      fail(
        "occupancyCompliant",
        `A household of ${profile.householdSize} needs at least ${occupancy.requiredAreaSqm} m² under § 7 WoAufG Bln; the flat has ${listing.livingAreaSqm} m².`,
        { householdSize: profile.householdSize, requiredAreaSqm: occupancy.requiredAreaSqm, livingAreaSqm: listing.livingAreaSqm },
      );
    }
  }
  return reasons;
}

// The rent-to-income ratio a household can afford when the maxRentToIncome Requirement is off.
export const DEFAULT_MAX_RENT_TO_INCOME = 1 / 3;

// The pool stats: counts over every profile, excluded or not. "Can afford" means a rent-to-income
// ratio at most the maxRentToIncome Requirement (1/3 while it is off), at the asking rent and at
// the Rent check's Mietspiegel median (null without a Rent check: unknown, not zero). Without an
// asking rent "can afford" is unknown too (null).
function statsOf(profiles, listing, requirements, excludedCount) {
  const maxRentToIncome = requirements.maxRentToIncome ?? DEFAULT_MAX_RENT_TO_INCOME;
  const medianRent = listing.rentCheck?.range?.median ?? null;
  const canAffordAt = (rent) => profiles.filter((profile) => rent / profile.netHouseholdIncome <= maxRentToIncome).length;
  return {
    total: profiles.length,
    completeDocuments: profiles.filter((profile) => profile.documentCheck.complete).length,
    canAfford: isMissing(listing.askingRent) ? null : canAffordAt(listing.askingRent),
    canAffordAtMedian: medianRent === null ? null : canAffordAt(medianRent),
    cleanSchufa: profiles.filter((profile) => profile.schufaStatus === "clean").length,
    excluded: excludedCount,
    maxRentToIncome,
    medianRent,
  };
}

// The landlord's bonus points: what a thumbs up adds to an applicant's ranking score and a thumbs
// down subtracts (Round 2, decision 6). The Match score itself stays objective.
export const DEFAULT_BONUS_POINTS = 5;
export const MAX_BONUS_POINTS = 20;

// Throws a TypeError for a rating other than 1 or -1, or bonus points that are not a non-negative
// number: a bad value would silently reorder the ranking.
function checkRatings(ratings, bonusPoints) {
  if (typeof bonusPoints !== "number" || !Number.isFinite(bonusPoints) || bonusPoints < 0) {
    throw new TypeError(`The bonus points must be a non-negative number, got ${bonusPoints}.`);
  }
  for (const [applicantId, rating] of ratings) {
    if (rating !== 1 && rating !== -1) throw new TypeError(`The rating of '${applicantId}' must be 1 or -1, got ${rating}.`);
  }
}

// How many of the top ranked applicants are recommended.
const RECOMMENDATION_COUNT = 2;

const byApplicantId = (a, b) => (a.applicantId < b.applicantId ? -1 : a.applicantId > b.applicantId ? 1 : 0);

// rankApplicants({ profiles, listing?, criteria?, ratings?, bonusPoints? }) → { ranked, excluded,
// stats, recommendations, inactive, activeWeights }
// - profiles: Applicant profiles (readApplicantPool's `profile`: anonymised, never a name).
// - listing: { livingAreaSqm, rooms, askingRent, rentCheck? } of the Landlord's Listing; the Rent
//   check's Mietspiegel median (`rentCheck.range.median`) feeds stats.canAffordAtMedian. Any of
//   them may be missing (null, or no listing at all): what depends on a missing fact is inactive.
// - inactive: [{ criterion | requirement, missing: [field] }]. An inactive criterion's share is 0
//   and the active ones are renormalised; an inactive Requirement is not evaluated.
// - activeWeights: { <criterion>: % of the Match score } after that (the weights when nothing is
//   inactive).
// - criteria: { weights?, requirements? }; what is left out is DEFAULT_CRITERIA's. Weights are
//   relative (any non-negative numbers, not all zero) and normalised to sum to 1. Throws a
//   TypeError for a weight or Requirement value of the wrong kind.
// - ratings: Map applicantId → 1 (thumbs up) | -1 (thumbs down), the landlord's; bonusPoints: N
//   (DEFAULT_BONUS_POINTS). A rated applicant's ranking score is the Match score + rating × N; the
//   Match score itself is unchanged. Throws a TypeError for another rating or a negative N.
// - ranked: the applicants who meet every Requirement, best first by Match score + bonus, ties by
//   applicant id:
//   [{ applicantId, rank (1…), matchScore (0–100, one decimal), rentToIncome (asking rent / net
//   household income; null without an asking rent), breakdown: { <criterion>: { subscore (0–1;
//   null when inactive), weight (% of the Match score) } } }]; a rated applicant's entry also has
//   rating (1 | -1) and bonus (+N | −N). Without ratings every entry has exactly the fields above.
// - excluded: the others, by applicant id: [{ applicantId, excludedBy (the first failed
//   Requirement), reasons: [{ requirement, message, …the values behind it }] }].
// - stats: counts over the whole pool: { total, completeDocuments, canAfford (null without an
//   asking rent), canAffordAtMedian (null without a Rent check), cleanSchufa, excluded, maxRentToIncome (the ratio "can afford"
//   uses: the Requirement's, or 1/3 while it is off), medianRent (null without a Rent check) }.
// - recommendations: the top two ranked applicants (fewer when fewer are ranked): [{ applicantId,
//   rank, matchScore, strengths: [criterion], weakness: criterion | null, reason: { de, en } }]
//   (the top of the ranking with the bonus),
//   the reason generated by code from the breakdown (see recommendationReasons).
// Pure and deterministic: the same input always gives the same result, whatever its order.
export function rankApplicants({ profiles, listing, criteria = {}, ratings = new Map(), bonusPoints = DEFAULT_BONUS_POINTS }) {
  listing ??= {};
  checkRatings(ratings, bonusPoints);
  const requirements = requirementsOf(criteria.requirements);
  const inactive = inactiveOf(listing, requirements);
  const shares = activeSharesOf(sharesOf(criteria.weights), inactive);
  // The Requirements evaluated: the inactive ones switched off.
  const evaluated = { ...requirements };
  for (const { requirement } of inactive) {
    if (requirement) evaluated[requirement] = DEFAULT_CRITERIA.requirements[requirement] === null ? null : false;
  }
  const excluded = [];
  const scored = [];
  for (const profile of profiles) {
    const rentToIncome = isMissing(listing.askingRent) ? null : listing.askingRent / profile.netHouseholdIncome;
    const reasons = failedRequirements(profile, rentToIncome, listing, evaluated);
    if (reasons.length > 0) {
      excluded.push({ applicantId: profile.id, excludedBy: reasons[0].requirement, reasons });
      continue;
    }
    const subscores = subscoresOf(profile, rentToIncome);
    const breakdown = Object.fromEntries(
      CRITERIA.map((criterion) => [
        criterion,
        { subscore: subscores[criterion] === null ? null : round(subscores[criterion], 4), weight: round(shares[criterion] * 100, 2) },
      ]),
    );
    const score = CRITERIA.reduce((sum, criterion) => sum + (subscores[criterion] ?? 0) * shares[criterion] * 100, 0);
    const rating = ratings.get(profile.id);
    // 0, not -0, for a thumbs down worth 0 points.
    const bonus = rating === undefined || bonusPoints === 0 ? 0 : rating * bonusPoints;
    scored.push({ applicantId: profile.id, score, bonus, rating, breakdown, rentToIncome: rentToIncome === null ? null : round(rentToIncome, 4) });
  }
  scored.sort((a, b) => b.score + b.bonus - (a.score + a.bonus) || byApplicantId(a, b));
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const ranked = scored.map(({ score, bonus, rating, ...entry }, index) => ({
    ...entry,
    rank: index + 1,
    matchScore: round(score, 1),
    ...(rating !== undefined && { rating, bonus }),
  }));
  return {
    ranked,
    excluded: excluded.sort(byApplicantId),
    stats: statsOf(profiles, listing, requirements, excluded.length),
    recommendations: ranked.slice(0, RECOMMENDATION_COUNT).map(({ applicantId, rank, matchScore, breakdown, rentToIncome }) => ({
      applicantId,
      rank,
      matchScore,
      ...recommendationReasons({ profile: profilesById.get(applicantId), breakdown, rentToIncome, matchScore }),
    })),
    inactive,
    activeWeights: Object.fromEntries(CRITERIA.map((criterion) => [criterion, round(shares[criterion] * 100, 2)])),
  };
}

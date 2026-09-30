import { MAX_BONUS_POINTS } from "./scorer.js";
import { UnknownApplicantError } from "./shortlist.js";

// The landlord's subjective bonus (Round 2, decision 6): a thumbs up or down per applicant, worth
// the bonus points N on the ranking. The one place each changes: the page's PUT / DELETE ratings go
// through updateRating, the chat Tool set_bonus_points through adjustBonusPoints, so their checks
// hold for every caller. The chat cannot rate applicants: no Tool calls updateRating.

// A rating's name on the page and in the API, and its value in the store and the scorer.
const RATING_VALUES = { up: 1, down: -1 };
const RATING_NAMES = new Map([[1, "up"], [-1, "down"]]);

// 1 → "up", -1 → "down", no rating → null.
export const ratingName = (rating) => RATING_NAMES.get(rating) ?? null;

export class RatingInputError extends Error {
  constructor(details) {
    super(details[0]?.message ?? "Rating input is invalid.");
    this.name = "RatingInputError";
    this.details = details;
  }
}

// updateRating({ store, landlordId, applicantIds, applicantId, rating }) → { applicantId, rating:
// "up" | "down" | null }
// - rating: "up" or "down" saves it (replacing the other); "remove" takes it off (removing a rating
//   that is not there changes nothing).
// - applicantIds: the ids of the Applicant pool (anything with has()). Rating needs an applicant in
//   the pool; a saved rating can still be removed after its applicant has left the pool, so it never
//   gets stuck.
// Throws RatingInputError or UnknownApplicantError; nothing is saved then.
export function updateRating({ store, landlordId, applicantIds, applicantId, rating }) {
  if (rating !== "remove" && !Object.hasOwn(RATING_VALUES, rating)) {
    throw new RatingInputError([{ field: "rating", code: "invalid", message: "'rating' must be 'up' or 'down'." }]);
  }
  const saved = store.getRatings(landlordId).has(applicantId);
  if (!applicantIds.has(applicantId) && !(rating === "remove" && saved)) throw new UnknownApplicantError(applicantId);

  if (rating === "remove") {
    store.removeRating(landlordId, applicantId);
    return { applicantId, rating: null };
  }
  store.setRating(landlordId, applicantId, RATING_VALUES[rating]);
  return { applicantId, rating };
}

// A refused bonus change. `kind: "input"`, so the chat's Tool wrapper treats it as the model's
// mistake rather than a failing service.
export class BonusInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "BonusInputError";
    this.kind = "input";
  }
}

// To one decimal, rounding what is .x5 on paper up: 6.5 × 0.7 = 4.55 → 4.6, not 4.5.
const oneDecimal = (value) => Math.round(Math.round(value * 1e9) / 1e8) / 10;

// adjustBonusPoints({ store, landlordId, by, value }) → { previous, bonusPoints, requested, capped }:
// the chat's "give my impression more weight", computed in code, never by the model (ADR 0004).
// - by "factor": the saved points × value (0 stays 0: set points instead); by "points": value.
// - requested, to one decimal; bonusPoints: what is saved, requested capped at MAX_BONUS_POINTS (20);
//   capped: whether it was.
// Throws BonusInputError for another `by`, or a value that is not a non-negative number, before
// the store changes.
export function adjustBonusPoints({ store, landlordId, by, value }) {
  if (by !== "factor" && by !== "points") throw new BonusInputError("'by' must be 'factor' or 'points'.");
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BonusInputError(`The ${by === "factor" ? "factor" : "bonus points"} must be a number of at least 0, got ${value}.`);
  }
  const previous = store.getBonusPoints(landlordId);
  const requested = oneDecimal(by === "factor" ? previous * value : value);
  const bonusPoints = Math.min(requested, MAX_BONUS_POINTS);
  store.saveBonusPoints(landlordId, bonusPoints);
  return { previous, bonusPoints, requested, capped: requested > MAX_BONUS_POINTS };
}

import { rankApplicants } from "./scorer.js";

// The household's shape for the page's avatar, from adults and children only (never from a
// protected characteristic such as gender): any children "family", else 1 adult "single", 2
// "couple", 3 or more "group".
export function householdShapeOf({ adults, children }) {
  if (children > 0) return "family";
  if (adults === 1) return "single";
  return adults === 2 ? "couple" : "group";
}

// The reusable, contact-free Applicant profile lookup. The later chat Tool and HTTP endpoint can
// use this directly; names and contact details stay in the source pool. `ratings` and `bonusPoints`
// are the landlord's (see rankApplicants), so the rank is the one the pages show.
// `ranking`: rankApplicants' result for exactly these arguments, when the caller has it already.
export function getApplicantProfile({ applicants, listing, applicantId, criteria = {}, ratings, bonusPoints, ranking }) {
  const applicant = applicants.find(({ id }) => id === applicantId);
  if (!applicant) return null;
  // Name clarification belongs to the UI workflow, not model-facing selection evidence.
  const profile = { ...applicant.profile, documentCheck: {
    ...applicant.profile.documentCheck,
    issues: applicant.profile.documentCheck.issues.filter(({ code }) => code !== "name_mismatch"),
  } };
  if (!listing) return { profile, score: null, rentToIncome: null };

  const { ranked, excluded } = ranking ?? rankApplicants({
    profiles: applicants.map(({ profile }) => profile),
    listing,
    criteria,
    ratings,
    bonusPoints,
  });
  const score = ranked.find((entry) => entry.applicantId === applicantId)
    ?? excluded.find((entry) => entry.applicantId === applicantId);
  const hasRent = listing.askingRent !== null && listing.askingRent !== undefined;
  const rentToIncome = hasRent ? (score.rentToIncome ?? Math.round((listing.askingRent / applicant.profile.netHouseholdIncome) * 10_000) / 10_000) : null;
  return { profile, score, rentToIncome };
}

import { rankApplicants } from "./scorer.js";

// A name mismatch is a valid Document check issue, but its source message includes the name
// printed on somebody else's document. Keep the issue and status without passing that name on.
function withoutDocumentNames(profile) {
  const mismatched = new Set(profile.documentCheck.issues.filter(({ code }) => code === "name_mismatch").map(({ document }) => document));
  if (mismatched.size === 0) return profile;
  const reason = "The document is in another person's name.";
  const documentCheck = { ...profile.documentCheck };
  for (const document of mismatched) documentCheck[document] = { ...documentCheck[document], reason };
  documentCheck.issues = documentCheck.issues.map((issue) =>
    issue.code === "name_mismatch" ? { ...issue, message: reason } : issue);
  return { ...profile, documentCheck };
}

// The household's shape for the page's avatar, from adults and children only (never from a
// protected characteristic such as gender): any children "family", else 1 adult "single", 2
// "couple", 3 or more "group".
export function householdShapeOf({ adults, children }) {
  if (children > 0) return "family";
  if (adults === 1) return "single";
  return adults === 2 ? "couple" : "group";
}

// The reusable, contact-free Applicant profile lookup. The chat Tool calls this directly, with the
// flat details as `listing` (so it scores before a Listing too); names and contact details are
// joined only by the HTTP endpoint for page display. No listing at all: no score. `ratings` and
// `bonusPoints` are the landlord's (see rankApplicants), so the rank is the one the pages show.
export function getApplicantProfile({ applicants, listing, applicantId, criteria = {}, ratings, bonusPoints }) {
  const applicant = applicants.find(({ id }) => id === applicantId);
  if (!applicant) return null;
  const profile = withoutDocumentNames(applicant.profile);
  if (!listing) return { profile, score: null, rentToIncome: null };

  const { ranked, excluded } = rankApplicants({
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

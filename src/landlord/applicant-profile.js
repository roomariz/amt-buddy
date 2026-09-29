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

// The reusable, contact-free Applicant profile lookup. The later chat Tool can call this
// directly; names and contact details are joined only by the HTTP endpoint for page display.
export function getApplicantProfile({ applicants, listing, applicantId, criteria = {} }) {
  const applicant = applicants.find(({ id }) => id === applicantId);
  if (!applicant) return null;
  const profile = withoutDocumentNames(applicant.profile);
  if (!listing) return { profile, score: null, rentToIncome: null };

  const { ranked, excluded } = rankApplicants({
    profiles: applicants.map(({ profile }) => profile),
    listing,
    criteria,
  });
  const score = ranked.find((entry) => entry.applicantId === applicantId)
    ?? excluded.find((entry) => entry.applicantId === applicantId);
  const rentToIncome = score.rentToIncome ?? Math.round((listing.askingRent / applicant.profile.netHouseholdIncome) * 10_000) / 10_000;
  return { profile, score, rentToIncome };
}

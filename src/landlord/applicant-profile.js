import { rankApplicants } from "./scorer.js";

// The reusable, contact-free Applicant profile lookup. The later chat Tool can call this
// directly; names and contact details are joined only by the HTTP endpoint for page display.
export function getApplicantProfile({ applicants, listing, applicantId, criteria = {} }) {
  const applicant = applicants.find(({ id }) => id === applicantId);
  if (!applicant) return null;
  // Name clarification belongs to the UI workflow, not model-facing selection evidence.
  const profile = { ...applicant.profile, documentCheck: {
    ...applicant.profile.documentCheck,
    issues: applicant.profile.documentCheck.issues.filter(({ code }) => code !== "name_mismatch"),
  } };
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

// The Applicant detail panel's translated view data. All score values come from the server's
// deterministic scorer; this module only formats and labels them.
import { t } from "../i18n.js";
import { breakdownBars, exclusionText, formatMoney, formatNumber, formatPercent } from "./ranking.js";

const DOCUMENTS = ["schufa", "incomeProof", "previousLandlord"];

export function applicantDetailView({ profile, score, rentToIncome, contact }) {
  const { documentCheck } = profile;
  const fact = (key, value) => ({ label: t(`landlord.detail.${key}`), value });
  const yesNo = (value) => t(`landlord.detail.${value ? "yes" : "no"}`);
  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    facts: [
      fact("household", t("landlord.detail.householdValue", profile.household)),
      fact("income", formatMoney(profile.netHouseholdIncome)),
      fact("rentToIncome", rentToIncome === null ? t("landlord.unknown") : formatPercent(rentToIncome)),
      fact("employment", t(`landlord.detail.employmentType.${profile.employmentType}`)),
      fact("schufa", t(`landlord.ranking.schufaStatus.${profile.schufaStatus}`)),
      fact("moveInDate", profile.moveInDate),
      fact("pets", yesNo(profile.pets)),
      fact("smoking", yesNo(profile.smoking)),
      fact("credibility", `${profile.credibilityScore}/100`),
    ],
    documents: DOCUMENTS.map((document) => ({
      label: t(`landlord.ranking.document.${document}`),
      status: t(`landlord.ranking.documentStatus.${documentCheck[document].status}`),
      reason: documentCheck[document].reason,
    })),
    issues: documentCheck.issues.map(({ document, message }) => ({
      label: t(`landlord.ranking.document.${document}`), message,
    })),
    matchScore: score?.matchScore === undefined ? null : formatNumber(score.matchScore),
    breakdown: score?.breakdown ? breakdownBars(score).map(({ criterion, percent, weight }) => ({
      label: t(`landlord.ranking.criteria.${criterion}`), percent, weight,
    })) : [],
    exclusion: score?.reasons ? score.reasons.map(exclusionText).join(" ") : null,
  };
}

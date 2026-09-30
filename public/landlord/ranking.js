// The ranked applicant table and the Excluded section of the /landlord page, as plain data (no DOM).

import { getLanguage, t } from "../i18n.js";

// The scoring criteria, in the order the breakdown bars show them.
export const CRITERIA = ["affordability", "schufa", "documents", "credibility", "employment", "previousLandlord"];

// The Requirements, in the order of the Scorer's DEFAULT_CRITERIA.requirements.
export const REQUIREMENTS = ["schufaCleanOnly", "completeDocumentsOnly", "maxRentToIncome", "noPets", "noSmoking", "latestMoveIn", "occupancyCompliant"];

const DOCUMENTS = ["schufa", "incomeProof", "previousLandlord"];
const FINE_STATUSES = new Set(["present", "not_required"]);

const byRank = (a, b) => a.rank - b.rank;
const COMPARATORS = {
  score: byRank,
  rentToIncome: (a, b) => a.rentToIncome - b.rentToIncome || byRank(a, b),
};

// The ranked applicants the table shows: sorted by `sort` ("score", best first, the default;
// "rentToIncome", lowest first) and, with `completeOnly`, only those with complete
// documents. Returns a new list.
export function rankingRows(ranked, { sort = "score", completeOnly = false } = {}) {
  const rows = completeOnly ? ranked.filter(({ documents }) => documents.complete) : [...ranked];
  return rows.sort(COMPARATORS[sort] ?? byRank);
}

// One ranked applicant → a bar per criterion: the subscore as a percentage (0–100) and the
// criterion's weight (% of the Match score).
export function breakdownBars({ breakdown }) {
  return CRITERIA.map((criterion) => {
    const { subscore, weight } = breakdown[criterion];
    return { criterion, percent: Math.round(subscore * 100), weight };
  });
}

// An applicant's document flags → [{ document, status, ok }]; `ok` when present or not required.
// A previous-landlord confirmation that reports rent arrears has the status "arrears", not ok.
export function documentFlags(documents) {
  return DOCUMENTS.map((document) => {
    if (document === "previousLandlord" && documents.arrears) return { document, status: "arrears", ok: false };
    return { document, status: documents[document], ok: FINE_STATUSES.has(documents[document]) };
  });
}

// A number in the page language ("91,5" / "91.5"), with at most one decimal.
export const formatNumber = (value) =>
  new Intl.NumberFormat(getLanguage() === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 1 }).format(value);

// An amount in euros in the page language ("490,00 €" / "€490.00").
export const formatMoney = (amount) =>
  new Intl.NumberFormat(getLanguage() === "en" ? "en-GB" : "de-DE", { style: "currency", currency: "EUR" }).format(amount);

// A ratio as a percentage in the page language (0.3571 → "35,7 %" / "35.7 %").
export const formatPercent = (ratio) => `${formatNumber(ratio * 100)} %`;

// The values of an exclusion reason as the text shows them.
function reasonValues(reason) {
  const values = { ...reason };
  if (typeof reason.rentToIncome === "number") values.rentToIncome = formatPercent(reason.rentToIncome);
  if (reason.requirement === "maxRentToIncome") values.limit = formatPercent(reason.limit);
  if (reason.schufaStatus) values.schufaStatus = t(`landlord.ranking.schufaStatus.${reason.schufaStatus}`);
  if (Array.isArray(reason.documents)) {
    values.documents = reason.documents.map((document) => t(`landlord.ranking.document.${document}`)).join(", ");
  }
  return values;
}

// One reason why an applicant is excluded ({ requirement, message, …values }) → its text in the
// page language; the server's message when the page does not know the Requirement.
export function exclusionText(reason) {
  const key = `landlord.ranking.excludedBy.${reason.requirement}`;
  const text = t(key, reasonValues(reason));
  return text === key ? reason.message : text;
}

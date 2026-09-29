// The ranked applicant table and the Excluded section of the /landlord page, as plain data (no DOM).

import { getLanguage, t } from "../i18n.js";

// The scoring criteria, in the order the breakdown bars show them.
export const CRITERIA = ["affordability", "schufa", "documents", "credibility", "employment", "previousLandlord"];

const DOCUMENTS = ["schufa", "incomeProof", "previousLandlord"];
const FINE_STATUSES = new Set(["present", "not_required"]);

const byRank = (a, b) => a.rank - b.rank;
const COMPARATORS = {
  rank: byRank,
  name: (a, b) => a.name.localeCompare(b.name, getLanguage()) || byRank(a, b),
  rentToIncome: (a, b) => a.rentToIncome - b.rentToIncome || byRank(a, b),
};

// The ranked applicants the table shows: sorted by `sort` ("rank", the default; "name";
// "rentToIncome", lowest first) and, with `completeOnly`, only those with complete documents.
// Returns a new list.
export function rankingRows(ranked, { sort = "rank", completeOnly = false } = {}) {
  const rows = completeOnly ? ranked.filter(({ documents }) => documents.complete) : [...ranked];
  return rows.sort(COMPARATORS[sort] ?? byRank);
}

const round1 = (value) => Math.round(value * 10) / 10;

// One ranked applicant → a bar per criterion: the subscore as a percentage (0–100), the
// criterion's weight (% of the Match score) and the points it adds to the Match score.
export function breakdownBars({ breakdown }) {
  return CRITERIA.map((criterion) => {
    const { subscore, weight } = breakdown[criterion];
    return { criterion, percent: Math.round(subscore * 100), weight, points: round1(subscore * weight) };
  });
}

// An applicant's document flags → [{ document, status, ok }]; `ok` when present or not required.
export function documentFlags(documents) {
  return DOCUMENTS.map((document) => ({ document, status: documents[document], ok: FINE_STATUSES.has(documents[document]) }));
}

const formatPercent = (ratio) =>
  `${new Intl.NumberFormat(getLanguage() === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 1 }).format(ratio * 100)} %`;

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

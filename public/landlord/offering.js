// The initial offering at the top of the /landlord dashboard: the pool summary, the stat tiles and
// the Recommendation cards, as plain data (no DOM).

import { getLanguage, t } from "../i18n.js";
import { formatNumber, formatPercent } from "./ranking.js";

// The stat tiles, in the order the page shows them.
export const STATS = ["total", "completeDocuments", "canAfford", "canAffordAtMedian", "cleanSchufa", "excluded"];

const money = (amount) =>
  new Intl.NumberFormat(getLanguage() === "en" ? "en-GB" : "de-DE", { style: "currency", currency: "EUR" }).format(amount);

// "You have N applicants, M can afford this rent."; null without stats (no Listing yet).
export function poolSummary(stats) {
  if (!stats) return null;
  return t("landlord.offering.summary", { total: stats.total, canAfford: stats.canAfford });
}

// How the count at the Mietspiegel median compares with the one at the asking rent.
function medianDetail(stats) {
  if (stats.canAffordAtMedian === null) return t("landlord.offering.medianUnavailable");
  const change = stats.canAffordAtMedian - stats.canAfford;
  const key = change > 0 ? "medianMore" : change < 0 ? "medianFewer" : "medianSame";
  return t(`landlord.offering.${key}`, { median: money(stats.medianRent), count: Math.abs(change) });
}

// The dashboard's stats (or null) → [{ stat, label, value, available, detail? }]. A count the
// server could not work out (null: the median without a Rent check) is unavailable, shown as "–".
export function statTiles(stats) {
  if (!stats) return [];
  return STATS.map((stat) => {
    const count = stats[stat];
    const tile = {
      stat,
      label: t(`landlord.offering.stats.${stat}`),
      value: count === null ? "–" : formatNumber(count),
      available: count !== null,
    };
    if (stat === "canAfford") tile.detail = t("landlord.offering.canAffordDetail", { limit: formatPercent(stats.maxRentToIncome) });
    if (stat === "canAffordAtMedian") tile.detail = medianDetail(stats);
    return tile;
  });
}

// The dashboard's Recommendations → the cards: [{ applicantId, rank, name, matchScore, reason }],
// the code-generated reason in the page language.
export function recommendationCards(recommendations) {
  return recommendations.map(({ applicantId, rank, name, matchScore, reason }) => ({
    applicantId,
    rank,
    name,
    matchScore: formatNumber(matchScore),
    reason: reason[getLanguage()] ?? reason.de,
  }));
}

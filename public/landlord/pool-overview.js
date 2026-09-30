// The pool overview at the top of the /landlord dashboard: the pool summary, the stat tiles and
// the Recommendation cards, as plain data (no DOM).

import { getLanguage, t } from "../i18n.js";
import { formatMoney, formatNumber, formatPercent } from "./ranking.js";

// The stat tiles, in the order the page shows them.
export const STAT_TILES = ["total", "completeDocuments", "canAfford", "canAffordAtMedian", "cleanSchufa", "excluded"];

// "You have N applicants, M can afford this rent."; null without stats (no Listing yet).
export function poolSummary(stats) {
  if (!stats) return null;
  return t("landlord.poolOverview.summary", { total: stats.total, canAfford: stats.canAfford });
}

// How the count at the Mietspiegel median compares with the one at the asking rent.
function medianDetail(stats) {
  if (stats.canAffordAtMedian === null) return t("landlord.poolOverview.medianUnavailable");
  const change = stats.canAffordAtMedian - stats.canAfford;
  const key = change > 0 ? "medianMore" : change < 0 ? "medianFewer" : "medianSame";
  return t(`landlord.poolOverview.${key}`, { median: formatMoney(stats.medianRent), count: Math.abs(change) });
}

// The dashboard's stats (or null) → [{ stat, label, value, available, detail? }]. A count the
// server could not work out (null: the median without a Rent check) is unavailable, shown as "–".
export function statTiles(stats) {
  if (!stats) return [];
  return STAT_TILES.map((stat) => {
    const count = stats[stat];
    const tile = {
      stat,
      label: t(`landlord.poolOverview.stats.${stat}`),
      value: count === null ? "–" : formatNumber(count),
      available: count !== null,
    };
    if (stat === "canAfford") tile.detail = t("landlord.poolOverview.canAffordDetail", { limit: formatPercent(stats.maxRentToIncome) });
    if (stat === "canAffordAtMedian") tile.detail = medianDetail(stats);
    return tile;
  });
}

// Why there are no Recommendation cards (null when there are some): the pool is empty, or no
// applicant meets every Requirement.
export function recommendationsEmptyText(stats, recommendations) {
  if (!stats || recommendations.length > 0) return null;
  return t(stats.total === 0 ? "landlord.poolOverview.poolEmpty" : "landlord.poolOverview.recommendationsEmpty");
}

// The dashboard's Recommendations → the cards: [{ applicantId, rank, matchScore, reason }],
// the code-generated reason in the page language.
export function recommendationCards(recommendations) {
  return recommendations.map(({ applicantId, rank, matchScore, reason }) => ({
    applicantId,
    rank,
    matchScore: formatNumber(matchScore),
    reason: reason[getLanguage()] ?? reason.de,
  }));
}

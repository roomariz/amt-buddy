// The Shortlist panel of the /landlord page, as plain data (no DOM).

import { t } from "../i18n.js";
import { formatNumber } from "./ranking.js";

// The statuses, in the order the status menu offers them.
export const SHORTLIST_STATUSES = ["to_invite", "invited", "declined"];

// Why an entry has no score: excluded by a Requirement, or no ranking yet (no Listing).
function scoreText({ matchScore, excluded }) {
  if (matchScore !== null) return t("landlord.shortlist.score", { score: formatNumber(matchScore) });
  return t(excluded ? "landlord.shortlist.excluded" : "landlord.shortlist.noScore");
}

// The dashboard's Shortlist → the panel's rows: [{ applicantId, name, score, status, statusLabel,
// note }], in the order the entries were added. An applicant no longer in the pool shows their id.
export function shortlistRows(shortlist) {
  return shortlist.map((entry) => ({
    applicantId: entry.applicantId,
    name: entry.name ?? entry.applicantId,
    score: scoreText(entry),
    status: entry.status,
    statusLabel: t(`landlord.shortlist.status.${entry.status}`),
    note: entry.note ?? "",
  }));
}

export const isShortlisted = (shortlist, applicantId) => shortlist.some((entry) => entry.applicantId === applicantId);

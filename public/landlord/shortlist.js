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

// The status menu's options: [{ value, label }], the label in the page language.
export const statusOptions = () => SHORTLIST_STATUSES.map((value) => ({ value, label: t(`landlord.shortlist.status.${value}`) }));

// The dashboard's Shortlist → the panel's rows: [{ applicantId, name, score, status, note }], in the
// order the entries were added. An applicant no longer in the pool shows their id.
export function shortlistRows(shortlist) {
  return shortlist.map((entry) => ({
    applicantId: entry.applicantId,
    name: entry.name ?? entry.applicantId,
    score: scoreText(entry),
    status: entry.status,
    note: entry.note ?? "",
  }));
}

export const isShortlisted = (shortlist, applicantId) => shortlist.some((entry) => entry.applicantId === applicantId);

// The Shortlist after a saved change ({ applicantId, status, note } as the server answered it):
// a removal ("removed") takes the entry off, a change keeps its position, and a new entry goes to
// the end with its name, rank and Match score from the dashboard's ranking ({ ranked, excluded }).
// Returns a new list, so the page can update without fetching the whole dashboard again.
export function applyShortlistChange(shortlist, { applicantId, status, note }, { ranked, excluded }) {
  if (status === "removed") return shortlist.filter((entry) => entry.applicantId !== applicantId);
  if (isShortlisted(shortlist, applicantId)) {
    return shortlist.map((entry) => (entry.applicantId === applicantId ? { ...entry, status, note } : entry));
  }
  const rankedEntry = ranked.find((entry) => entry.applicantId === applicantId);
  const excludedEntry = excluded.find((entry) => entry.applicantId === applicantId);
  return [
    ...shortlist,
    {
      applicantId,
      name: rankedEntry?.name ?? excludedEntry?.name ?? null,
      status,
      note,
      rank: rankedEntry?.rank ?? null,
      matchScore: rankedEntry?.matchScore ?? null,
      excluded: Boolean(excludedEntry),
    },
  ];
}

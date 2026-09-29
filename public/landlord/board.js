// The chat-first landlord page's board: the Recommendation slots and the Shortlist sidebar, as
// plain data (no DOM).

import { getLanguage, t } from "../i18n.js";
import { formatNumber } from "./ranking.js";

// Which applicant sits in which Recommendation slot. The slots show the best `current.length`
// ranked applicants who are not hidden (shortlisted or skipped). Someone still among them keeps
// their slot, so a card doesn't jump when the other one is acted on; only the freed slots are
// refilled, in rank order. An applicant no longer in `ranked` (excluded by a Requirement) is
// not a candidate. A slot nobody is left for is null.
export function fillSlots({ ranked, current = [null, null], hidden = new Set() }) {
  const best = ranked
    .map(({ applicantId }) => applicantId)
    .filter((applicantId) => !hidden.has(applicantId))
    .slice(0, current.length);
  const kept = current.map((applicantId) => (best.includes(applicantId) ? applicantId : null));
  const waiting = best.filter((applicantId) => !kept.includes(applicantId));
  return kept.map((applicantId) => applicantId ?? waiting.shift() ?? null);
}

// A ranked entry of the overview → the slot card: name, household shape, "#3 of 34", the Match
// score and the code-generated reason in the page language.
export function slotCard({ applicantId, name, householdShape, rank, matchScore, reason }, { total }) {
  return {
    applicantId,
    name,
    householdShape,
    rankText: t("landlordChat.slotRank", { rank, total }),
    scoreText: t("landlordChat.slotScore", { score: formatNumber(matchScore) }),
    reason: reason[getLanguage()] ?? reason.de,
  };
}

// The overview's Shortlist → the sidebar rows. Where an entry stands is its current rank, or the
// short label of the Requirement that now excludes them; a missing name falls back to the id.
export function sidebarRows(shortlist) {
  return shortlist.map(({ applicantId, name, householdShape, status, rank, excluded, excludedBy }) => {
    const displayName = name ?? applicantId;
    return {
      applicantId,
      name: displayName,
      householdShape,
      placeText: excluded
        ? t("landlordChat.shortlistExcluded", { reason: t(`landlordChat.excludedBy.${excludedBy}`) })
        : t("landlordChat.shortlistRank", { rank }),
      excluded,
      statusText: t(`landlord.shortlist.status.${status}`),
      removeLabel: t("landlordChat.removeLabel", { name: displayName }),
    };
  });
}

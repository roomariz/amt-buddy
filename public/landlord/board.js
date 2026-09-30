// The chat-first landlord page's board: the Recommendation slots and the Shortlist sidebar, as
// plain data (no DOM).

import { getLanguage, t } from "../i18n.js";
import { moveText } from "./rank-moves.js";
import { formatNumber } from "./ranking.js";

// Which applicant sits in which Recommendation slot. The candidates are the best `poolSize` ranked
// applicants who are not hidden (shortlisted or skipped). Someone still among them keeps their
// slot, so a card doesn't jump when the other one is acted on or the ranking shifts a little; each
// freed slot, in slot order, is filled by a random pick among the candidates not already shown, so
// the landlord isn't only ever offered the same two at the top. An applicant no longer in `ranked`
// (excluded by a Requirement) is not a candidate. A slot nobody is left for is null. `random` is
// injectable so the tests are deterministic; it is not called when no one is available.
export function fillSlots({ ranked, current = [null, null], hidden = new Set(), poolSize = 6, random = Math.random }) {
  const candidates = ranked
    .map(({ applicantId }) => applicantId)
    .filter((applicantId) => !hidden.has(applicantId))
    .slice(0, poolSize);
  const slots = current.map((applicantId) => (candidates.includes(applicantId) ? applicantId : null));
  const available = candidates.filter((applicantId) => !slots.includes(applicantId));
  return slots.map((applicantId) => {
    if (applicantId !== null || available.length === 0) return applicantId;
    return available.splice(Math.floor(random() * available.length), 1)[0];
  });
}

// A ranked entry of the overview → the slot card: name, household shape, "#3 of 34", the Match
// score, how far they moved with the last change (`move`, places up if positive), the
// code-generated reason in the page language, and the landlord's own rating with its bonus.
export function slotCard({ applicantId, name, householdShape, rank, matchScore, reason, rating, bonus }, { total, move }) {
  const text = moveText(move);
  return {
    applicantId,
    name,
    householdShape,
    scoreText: t("landlordChat.slotScore", { score: formatNumber(matchScore) }),
    move: text && { ...text, direction: move > 0 ? "up" : "down" },
    rankText: t("landlordChat.slotRank", { rank, total }),
    reason: reason[getLanguage()] ?? reason.de,
    rating: rating ?? null,
    bonusText: bonus
      ? t("landlordChat.bonusText", { sign: bonus > 0 ? "+" : "\u2212", points: formatNumber(Math.abs(bonus)) })
      : null,
  };
}

// The overview's Shortlist → the sidebar rows. Where an entry stands is its current rank (no move
// arrow here), or the short label of the Requirement that now excludes them; a missing name falls
// back to the id. A note only makes sense for someone still to be invited or already invited.
export function sidebarRows(shortlist) {
  return shortlist.map(({ applicantId, name, householdShape, status, note, rank, excluded, excludedBy, rating }) => {
    const displayName = name ?? applicantId;
    return {
      applicantId,
      name: displayName,
      householdShape,
      placeText: excluded
        ? t("landlordChat.shortlistExcluded", { reason: t(`landlordChat.excludedBy.${excludedBy}`) })
        : t("landlordChat.shortlistRank", { rank }),
      excluded,
      status,
      statusText: t(`landlord.shortlist.status.${status}`),
      note,
      noteAllowed: status === "to_invite" || status === "invited",
      rating: rating ?? null,
      removeLabel: t("landlordChat.removeLabel", { name: displayName }),
    };
  });
}

// The chat's second message after a turn that changed the ranking (priorities, flat details or the
// bonus): the current top 3 by rank, as plain data (no DOM). Written by code, not by the model, and
// deliberately not random: a second way to see applicants beside the Recommendation slots.

import { slotCard } from "./board.js";
import { t } from "../i18n.js";

// The overview's ranked list → { intro, items } for the 3 best ranks (sorted here, whatever order the
// list arrives in), or null when nobody is ranked. Each item reuses the slot card's texts (score,
// bonus, reason in the page language); a missing name falls back to the id.
export function topApplicantsMessage(ranked) {
  const top = [...(ranked ?? [])].sort((a, b) => a.rank - b.rank).slice(0, 3);
  if (top.length === 0) return null;
  return {
    intro: t(top.length === 3 ? "landlordChat.topIntro" : "landlordChat.topIntroFew"),
    items: top.map((entry) => {
      const { scoreText, bonusText, reason } = slotCard(entry, { total: ranked.length, move: 0 });
      return { applicantId: entry.applicantId, name: entry.name ?? entry.applicantId, rank: entry.rank, scoreText, bonusText, reason };
    }),
  };
}

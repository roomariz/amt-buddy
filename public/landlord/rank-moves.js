// How far each applicant moved in the ranking with the last change of the Selection criteria or the
// flat details, as plain data (no DOM). The chat-first page shows it as an arrow beside the rank.

import { t } from "../i18n.js";

// before/after: [{ applicantId, rank }] (or null when there was no earlier ranking) → Map of
// applicantId → places moved. Positive is up the ranking (a smaller rank number), negative down.
// An applicant who did not move, or was not ranked both times (newly ranked, or now excluded),
// has no entry: there is nothing honest to say about how far they moved.
export function rankMoves(before, after) {
  const moves = new Map();
  if (!before?.length || !after?.length) return moves;
  const rankBefore = new Map(before.map(({ applicantId, rank }) => [applicantId, rank]));
  for (const { applicantId, rank } of after) {
    if (!rankBefore.has(applicantId)) continue;
    const delta = rankBefore.get(applicantId) - rank;
    if (delta !== 0) moves.set(applicantId, delta);
  }
  return moves;
}

// A move → { text: "↑2" | "↓1", label } (label is the spoken form for screen readers), or null
// when there is no move to show.
export function moveText(delta) {
  if (!delta) return null;
  const count = Math.abs(delta);
  const up = delta > 0;
  return {
    text: t(up ? "landlordChat.moveUp" : "landlordChat.moveDown", { count }),
    label: t(up ? "landlordChat.moveUpLabel" : "landlordChat.moveDownLabel", { count }),
  };
}

// The remembered-preferences list of the /landlord page, as plain data (no DOM): the free-text
// Landlord preferences the chat remembered (remember_preference), each deletable by the landlord.

import { getLanguage, t } from "../i18n.js";

// The day a note was remembered, in the page language ("28.09.2026" / "28/09/2026"), Berlin time.
const formatDay = (timestamp) =>
  new Intl.DateTimeFormat(getLanguage() === "en" ? "en-GB" : "de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(timestamp));

// The dashboard's notes → the list's rows: [{ noteId, note, date, deleteLabel }], oldest first.
export function preferenceRows(notes) {
  return (notes ?? []).map(({ noteId, note, created }) => ({
    noteId,
    note,
    date: t("landlord.preferences.remembered", { date: formatDay(created) }),
    deleteLabel: t("landlord.preferences.deleteLabel", { note }),
  }));
}

// The notes without the deleted one, so the page updates without fetching the dashboard again.
export const withoutNote = (notes, noteId) => notes.filter((entry) => entry.noteId !== noteId);

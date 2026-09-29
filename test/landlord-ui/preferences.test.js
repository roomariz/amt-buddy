// The remembered-preferences list of the /landlord page (public/landlord/preferences.js), and its
// delete call against the real server.
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../src/app.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";
import { deleteNote, fetchDashboard, signIn } from "../../public/landlord/api.js";
import { preferenceRows, withoutNote } from "../../public/landlord/preferences.js";
import { setLanguage } from "../../public/i18n.js";

// The notes as GET /api/v1/landlord/:landlordId/dashboard returns them.
const NOTES = [
  { noteId: "n-1", note: "Wants someone who stays long-term.", created: "2026-09-28T09:15:00.000Z" },
  { noteId: "n-2", note: "Prefers a quiet tenant.", created: "2026-09-29T17:40:00.000Z" },
];

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("each remembered preference shows its text, the day it was remembered and a labelled delete button, DE and EN", () => {
  assert.deepEqual(inLanguage("en", () => preferenceRows(NOTES)), [
    { noteId: "n-1", note: "Wants someone who stays long-term.", date: "Remembered on 28/09/2026", deleteLabel: "Delete: Wants someone who stays long-term." },
    { noteId: "n-2", note: "Prefers a quiet tenant.", date: "Remembered on 29/09/2026", deleteLabel: "Delete: Prefers a quiet tenant." },
  ]);
  assert.deepEqual(inLanguage("de", () => preferenceRows(NOTES)).map(({ date, deleteLabel }) => [date, deleteLabel]), [
    ["Gemerkt am 28.09.2026", "Löschen: Wants someone who stays long-term."],
    ["Gemerkt am 29.09.2026", "Löschen: Prefers a quiet tenant."],
  ]);
  assert.deepEqual(preferenceRows([]), []);
  assert.deepEqual(preferenceRows(undefined), []);
});

test("a deleted note leaves the list; the others keep their order", () => {
  assert.deepEqual(withoutNote(NOTES, "n-1"), [NOTES[1]]);
  assert.deepEqual(withoutNote(NOTES, "n-9"), NOTES);
});

test("the page deletes a remembered preference on the server; deleting it again is notFound, a lost sign-in signedOut", async (t) => {
  const store = createLandlordStore({ path: ":memory:" });
  const app = createApp({ env: {}, landlordStore: store, fetchImpl: createFakeBerlinWfs().fetchImpl });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const fetchImpl = (url, init) => fetch(base + url, init);
  const { landlordId } = await signIn({ fetchImpl, name: "Erika" });
  const kept = store.addNote(landlordId, "Wants someone who stays long-term.");
  const gone = store.addNote(landlordId, "Prefers a quiet tenant.");

  assert.deepEqual((await fetchDashboard({ fetchImpl, landlordId })).notes, [kept, gone]);
  assert.deepEqual(await deleteNote({ fetchImpl, landlordId, noteId: gone.noteId }), { deleted: true });
  assert.deepEqual(await deleteNote({ fetchImpl, landlordId, noteId: gone.noteId }), { notFound: true });
  assert.deepEqual(await deleteNote({ fetchImpl, landlordId: "gone", noteId: kept.noteId }), { signedOut: true });
  assert.deepEqual((await fetchDashboard({ fetchImpl, landlordId })).notes, [kept]);
});

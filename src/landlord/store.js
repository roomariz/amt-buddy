import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_CRITERIA } from "./scorer.js";

// The landlord's state in SQLite (Node's built-in node:sqlite). Later landlord tickets add
// their own tables (preference notes) next to landlords, listings, criteria and shortlist.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS landlords (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS listings (
    landlord_id TEXT PRIMARY KEY REFERENCES landlords(id),
    listing TEXT NOT NULL,
    updated TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS criteria (
    landlord_id TEXT PRIMARY KEY REFERENCES landlords(id),
    criteria TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shortlist (
    landlord_id TEXT NOT NULL REFERENCES landlords(id),
    applicant_id TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    added TEXT NOT NULL,
    updated TEXT NOT NULL,
    PRIMARY KEY (landlord_id, applicant_id)
  );
`;

const DEFAULT_DATABASE_PATH = fileURLToPath(new URL("../../data/landlord.sqlite", import.meta.url));

// The SQLite file for the landlord store: LANDLORD_DB_PATH, or data/landlord.sqlite (gitignored).
export const landlordDatabasePath = (env) => env.LANDLORD_DB_PATH?.trim() || DEFAULT_DATABASE_PATH;

// A sign-in name: trimmed, inner whitespace collapsed.
export const normalizeLandlordName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");

// Two names are the same landlord when they match trimmed and case-insensitively.
const nameKey = (name) => normalizeLandlordName(name).toLocaleLowerCase("de-DE");

const toLandlord = (row) => (row ? { landlordId: row.id, name: row.name } : null);

// createLandlordStore({ path }) → the landlord repository. `path` is the SQLite file (its
// directory is created), or ":memory:" for a database that lives as long as the store.
// - signIn(name) → { landlordId, name }: the landlord with this name, created on first sign-in.
// - getLandlord(landlordId) → { landlordId, name }, or null when there is none.
// - saveListing(landlordId, listing) → listing: replaces the landlord's one Listing.
// - getListing(landlordId) → the Listing, or null when none was saved.
// - getCriteria(landlordId): saved Selection criteria, or a fresh copy of the defaults.
// - saveCriteria(landlordId, criteria): stores validated Selection criteria.
// - saveShortlistEntry(landlordId, { applicantId, status, note }): adds the entry or replaces its
//   status and note; an entry keeps the time it was first added. No validation: see shortlist.js.
// - removeShortlistEntry(landlordId, applicantId): removes the entry, if there is one.
// - getShortlist(landlordId) → [{ applicantId, status, note, added, updated }], in the order added.
// - close(): closes the database.
export function createLandlordStore({ path = ":memory:" } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const selectByKey = db.prepare("SELECT id, name FROM landlords WHERE name_key = ?");
  const selectById = db.prepare("SELECT id, name FROM landlords WHERE id = ?");
  const insertLandlord = db.prepare("INSERT INTO landlords (id, name, name_key, created) VALUES (?, ?, ?, ?)");
  const upsertListing = db.prepare(
    `INSERT INTO listings (landlord_id, listing, updated) VALUES (?, ?, ?)
     ON CONFLICT (landlord_id) DO UPDATE SET listing = excluded.listing, updated = excluded.updated`,
  );
  const selectListing = db.prepare("SELECT listing FROM listings WHERE landlord_id = ?");
  const selectCriteria = db.prepare("SELECT criteria FROM criteria WHERE landlord_id = ?");
  const upsertCriteria = db.prepare(
    `INSERT INTO criteria (landlord_id, criteria) VALUES (?, ?)
     ON CONFLICT (landlord_id) DO UPDATE SET criteria = excluded.criteria`,
  );
  const upsertShortlistEntry = db.prepare(
    `INSERT INTO shortlist (landlord_id, applicant_id, status, note, added, updated) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (landlord_id, applicant_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated = excluded.updated`,
  );
  const deleteShortlistEntry = db.prepare("DELETE FROM shortlist WHERE landlord_id = ? AND applicant_id = ?");
  // rowid breaks ties between entries added within the same millisecond.
  const selectShortlist = db.prepare(
    "SELECT applicant_id, status, note, added, updated FROM shortlist WHERE landlord_id = ? ORDER BY added, rowid",
  );

  return {
    signIn(name) {
      const key = nameKey(name);
      const existing = selectByKey.get(key);
      if (existing) return toLandlord(existing);
      const landlord = { landlordId: randomUUID(), name: normalizeLandlordName(name) };
      insertLandlord.run(landlord.landlordId, landlord.name, key, new Date().toISOString());
      return landlord;
    },
    getLandlord(landlordId) {
      return toLandlord(selectById.get(landlordId));
    },
    saveListing(landlordId, listing) {
      upsertListing.run(landlordId, JSON.stringify(listing), new Date().toISOString());
      return listing;
    },
    getListing(landlordId) {
      const row = selectListing.get(landlordId);
      return row ? JSON.parse(row.listing) : null;
    },
    saveShortlistEntry(landlordId, { applicantId, status, note }) {
      const now = new Date().toISOString();
      upsertShortlistEntry.run(landlordId, applicantId, status, note, now, now);
    },
    removeShortlistEntry(landlordId, applicantId) {
      deleteShortlistEntry.run(landlordId, applicantId);
    },
    getShortlist(landlordId) {
      return selectShortlist.all(landlordId).map((row) => ({
        applicantId: row.applicant_id,
        status: row.status,
        note: row.note,
        added: row.added,
        updated: row.updated,
      }));
    },
    close() {
      db.close();
    },
    getCriteria(landlordId) {
      const row = selectCriteria.get(landlordId);
      return row ? JSON.parse(row.criteria) : structuredClone(DEFAULT_CRITERIA);
    },
    saveCriteria(landlordId, criteria) {
      upsertCriteria.run(landlordId, JSON.stringify(criteria));
      return criteria;
    },
  };
}

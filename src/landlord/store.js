import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_CRITERIA } from "./scorer.js";

// The landlord's state in SQLite (Node's built-in node:sqlite). Later landlord tickets add
// their own tables (preference notes, shortlist) next to landlords, listings and criteria.
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
  CREATE TABLE IF NOT EXISTS clarification_requests (
    landlord_id TEXT NOT NULL REFERENCES landlords(id),
    applicant_id TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    deadline TEXT NOT NULL,
    PRIMARY KEY (landlord_id, applicant_id)
  );
  CREATE TABLE IF NOT EXISTS criteria (
    landlord_id TEXT PRIMARY KEY REFERENCES landlords(id),
    criteria TEXT NOT NULL
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
// - getClarification(landlordId, applicantId): simulated request with its current deadline status.
// - requestClarification(landlordId, applicantId): records once; retries preserve the first deadline.
// - close(): closes the database.
export function createLandlordStore({ path = ":memory:", now = () => new Date() } = {}) {
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

  const selectClarification = db.prepare("SELECT requested_at, deadline FROM clarification_requests WHERE landlord_id = ? AND applicant_id = ?");
  const insertClarification = db.prepare("INSERT OR IGNORE INTO clarification_requests (landlord_id, applicant_id, requested_at, deadline) VALUES (?, ?, ?, ?)");
  function getClarification(landlordId, applicantId) {
    const row = selectClarification.get(landlordId, applicantId);
    return row ? {
      requestedAt: row.requested_at, deadline: row.deadline, simulated: true,
      status: now().toISOString() >= row.deadline ? "overdue" : "pending",
    } : null;
  }

  return {
    getClarification,
    requestClarification(landlordId, applicantId) {
      const requestedAt = now();
      const deadline = new Date(requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      insertClarification.run(landlordId, applicantId, requestedAt.toISOString(), deadline.toISOString());
      return getClarification(landlordId, applicantId);
    },
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

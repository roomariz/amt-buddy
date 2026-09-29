import { SHORTLIST_STATUSES } from "./orchestrator/tool-contracts.js";

// The one place the Shortlist is changed: the dashboard's PUT / DELETE and the chat Tool
// update_shortlist (#46) both call updateShortlist, so its checks hold for every caller.

const MAX_NOTE_LENGTH = 500;

export class ShortlistInputError extends Error {
  constructor(details) {
    super(details[0]?.message ?? "Shortlist input is invalid.");
    this.name = "ShortlistInputError";
    this.details = details;
  }
}

// An applicant id that is not in the Applicant pool. `kind: "input"`, so the chat's Tool wrapper
// treats it as the model's mistake rather than a failing service.
export class UnknownApplicantError extends Error {
  constructor(applicantId) {
    super(`There is no applicant '${applicantId}' in the Applicant pool.`);
    this.name = "UnknownApplicantError";
    this.kind = "input";
    this.applicantId = applicantId;
  }
}

function statusProblem(status) {
  if (status === "remove" || SHORTLIST_STATUSES.includes(status)) return null;
  return {
    field: "status",
    code: "invalid",
    message: `'status' must be one of ${SHORTLIST_STATUSES.map((value) => `'${value}'`).join(", ")}.`,
  };
}

function noteProblem(note) {
  if (note === undefined || note === null) return null;
  if (typeof note === "string" && note.trim().length <= MAX_NOTE_LENGTH) return null;
  return { field: "note", code: "invalid", message: `'note' must be a string of at most ${MAX_NOTE_LENGTH} characters.` };
}

// updateShortlist({ store, landlordId, applicantIds, applicantId, status, note? }) → the entry as
// the update_shortlist Tool contract returns it: { applicantId, status, note }.
// - applicantIds: the ids of the Applicant pool (anything with has()). Only a new entry must be in
//   the pool: one already on the Shortlist can still be changed or removed after its applicant
//   has left the pool (e.g. another APPLICANT_POOL_DIR), so it never gets stuck.
// - status: 'to_invite', 'invited' or 'declined' adds or changes the entry; 'remove' takes it off
//   the Shortlist (reported as 'removed'; removing an applicant who is not on it changes nothing).
// - note: trimmed; left out, the entry keeps its note; null or blank clears it.
// Throws ShortlistInputError (invalid status or note) or UnknownApplicantError; nothing is saved then.
export function updateShortlist({ store, landlordId, applicantIds, applicantId, status, note }) {
  const problems = [statusProblem(status), noteProblem(note)].filter(Boolean);
  if (problems.length > 0) throw new ShortlistInputError(problems);
  const current = store.getShortlist(landlordId).find((entry) => entry.applicantId === applicantId);
  if (!current && !applicantIds.has(applicantId)) throw new UnknownApplicantError(applicantId);

  if (status === "remove") {
    store.removeShortlistEntry(landlordId, applicantId);
    return { applicantId, status: "removed", note: null };
  }
  const entry = { applicantId, status, note: note === undefined ? (current?.note ?? null) : note?.trim() || null };
  store.saveShortlistEntry(landlordId, entry);
  return entry;
}

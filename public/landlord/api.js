// The /landlord page's calls to the server (docs/api.md, "Landlord").
// `fetchImpl` is the browser's fetch; tests pass a fake or run against the real app.
// Failures that are not the landlord's to fix throw an Error with a reason in the UI language.

import { t } from "../i18n.js";

async function call(fetchImpl, url, { method = "GET", body } = {}) {
  try {
    const response = await fetchImpl(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    throw new Error(t("landlord.errors.unreachable"));
  }
}

const landlordPath = (landlordId, rest) => `/api/v1/landlord/${encodeURIComponent(landlordId)}/${rest}`;

// Signs in by name → { landlordId, name }.
export async function signIn({ fetchImpl, name }) {
  const { status, body } = await call(fetchImpl, "/api/v1/landlord/sessions", { method: "POST", body: { name } });
  if (status === 200 && typeof body?.data?.landlordId === "string") return body.data;
  throw new Error(t(status === 422 ? "landlord.errors.nameRequired" : "landlord.errors.failed"));
}

// Saves the Listing → { listing } when saved, { problems: { field: message } } when the server
// rejects fields, or { signedOut: true } when the server does not know the landlord.
export async function saveListing({ fetchImpl, landlordId, request }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, "listing"), { method: "PUT", body: request });
  if (status === 200 && body?.data) return { listing: body.data };
  if (status === 404) return { signedOut: true };
  if (status === 422 && Array.isArray(body?.error?.details)) {
    return { problems: Object.fromEntries(body.error.details.map((detail) => [detail.field, detail.message])) };
  }
  throw new Error(t("landlord.errors.failed"));
}

// The dashboard → { listing, rentCheck, criteria, ranked, excluded, stats, recommendations, hint, shortlist, notes, poolErrors }, or
// { signedOut: true } when the server does not know the landlord.
export async function fetchDashboard({ fetchImpl, landlordId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, "dashboard"));
  if (status === 200 && body?.data) return body.data;
  if (status === 404) return { signedOut: true };
  throw new Error(t("landlord.errors.failed"));
}

// The chat-first page's data (docs/api.md, "GET overview") → { flat, missing, rentCheck, criteria,
// inactive, ranked, stats, shortlist, … }, or { signedOut: true } when the server does not know the
// landlord.
export async function fetchOverview({ fetchImpl, landlordId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, "overview"));
  if (status === 200 && body?.data) return body.data;
  if (status === 404) return { signedOut: true };
  throw new Error(t("landlord.errors.failed"));
}

const shortlistPath = (landlordId, applicantId) => landlordPath(landlordId, `shortlist/${encodeURIComponent(applicantId)}`);

// Adds an applicant to the Shortlist or changes their status (and, when given, note) → { entry },
// { problems: { field: message } } when the server rejects a value, { notFound: true } for an
// applicant the pool does not know, or { signedOut: true }.
export async function saveShortlistEntry({ fetchImpl, landlordId, applicantId, status, note }) {
  const body = note === undefined ? { status } : { status, note };
  const response = await call(fetchImpl, shortlistPath(landlordId, applicantId), { method: "PUT", body });
  if (response.status === 200 && response.body?.data) return { entry: response.body.data };
  if (response.status === 404 && response.body?.error?.code === "landlord_not_found") return { signedOut: true };
  if (response.status === 404 && response.body?.error?.code === "applicant_not_found") return { notFound: true };
  if (response.status === 422 && Array.isArray(response.body?.error?.details)) {
    return { problems: Object.fromEntries(response.body.error.details.map((detail) => [detail.field, detail.message])) };
  }
  throw new Error(t("landlord.errors.failed"));
}

// Takes an applicant off the Shortlist → { entry } (status "removed"), { notFound: true } for an
// applicant the pool does not know, or { signedOut: true }.
export async function removeShortlistEntry({ fetchImpl, landlordId, applicantId }) {
  const { status, body } = await call(fetchImpl, shortlistPath(landlordId, applicantId), { method: "DELETE" });
  if (status === 200 && body?.data) return { entry: body.data };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  if (status === 404 && body?.error?.code === "applicant_not_found") return { notFound: true };
  throw new Error(t("landlord.errors.failed"));
}

const ratingPath = (landlordId, applicantId) => landlordPath(landlordId, `ratings/${encodeURIComponent(applicantId)}`);

// Rates an applicant "up" or "down" → { rating }, { notFound: true } for an applicant the pool
// does not know, or { signedOut: true }.
export async function saveRating({ fetchImpl, landlordId, applicantId, rating }) {
  const { status, body } = await call(fetchImpl, ratingPath(landlordId, applicantId), { method: "PUT", body: { rating } });
  if (status === 200 && body?.data) return { rating: body.data.rating };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  if (status === 404 && body?.error?.code === "applicant_not_found") return { notFound: true };
  throw new Error(t("landlord.errors.failed"));
}

// Takes an applicant's rating away → { rating: null }, { notFound: true } for an applicant the pool
// does not know, or { signedOut: true }.
export async function removeRating({ fetchImpl, landlordId, applicantId }) {
  const { status, body } = await call(fetchImpl, ratingPath(landlordId, applicantId), { method: "DELETE" });
  if (status === 200 && body?.data) return { rating: null };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  if (status === 404 && body?.error?.code === "applicant_not_found") return { notFound: true };
  throw new Error(t("landlord.errors.failed"));
}

// Deletes a remembered Landlord preference → { deleted: true }, { notFound: true } when the landlord
// has no such note (any more), or { signedOut: true }.
export async function deleteNote({ fetchImpl, landlordId, noteId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, `notes/${encodeURIComponent(noteId)}`), { method: "DELETE" });
  if (status === 200 && body?.data?.deleted) return { deleted: true };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  if (status === 404 && body?.error?.code === "note_not_found") return { notFound: true };
  throw new Error(t("landlord.errors.failed"));
}

// Save changed Selection criteria → the refreshed dashboard, or validation problems.
export async function saveCriteria({ fetchImpl, landlordId, request }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, "criteria"), { method: "PUT", body: request });
  if (status === 200 && body?.data) return { dashboard: body.data };
  if (status === 404) return { signedOut: true };
  if (status === 422 && Array.isArray(body?.error?.details)) {
    return { problems: Object.fromEntries(body.error.details.map((detail) => [detail.field, detail.code])) };
  }
}

// One Applicant profile for page display. An unknown applicant is distinct from a lost sign-in.
export async function fetchApplicantProfile({ fetchImpl, landlordId, applicantId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, `applicants/${encodeURIComponent(applicantId)}`));
  if (status === 200 && body?.data) return body.data;
  if (status === 404 && body?.error?.code === "applicant_not_found") return { notFound: true };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  throw new Error(t("landlord.errors.failed"));
}

// Records a simulation only. The server never sends an applicant message.
export async function requestClarification({ fetchImpl, landlordId, applicantId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, `applicants/${encodeURIComponent(applicantId)}/clarification`), { method: "POST", body: {} });
  if (status === 200 && body?.data) return body.data;
  if (status === 404 && body?.error?.code === "applicant_not_found") return { notFound: true };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  throw new Error(t("landlord.errors.failed"));
}

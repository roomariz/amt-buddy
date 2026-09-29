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

// The dashboard → { listing, rentCheck, criteria, ranked, excluded, stats, recommendations, hint, poolErrors }, or
// { signedOut: true } when the server does not know the landlord.
export async function fetchDashboard({ fetchImpl, landlordId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, "dashboard"));
  if (status === 200 && body?.data) return body.data;
  if (status === 404) return { signedOut: true };
  throw new Error(t("landlord.errors.failed"));
}

// One Applicant profile for page display. An unknown applicant is distinct from a lost sign-in.
export async function fetchApplicantProfile({ fetchImpl, landlordId, applicantId }) {
  const { status, body } = await call(fetchImpl, landlordPath(landlordId, `applicants/${encodeURIComponent(applicantId)}`));
  if (status === 200 && body?.data) return body.data;
  if (status === 404 && body?.error?.code === "applicant_not_found") return { notFound: true };
  if (status === 404 && body?.error?.code === "landlord_not_found") return { signedOut: true };
  throw new Error(t("landlord.errors.failed"));
}

import { randomUUID } from "node:crypto";

export const DOCUMENT_TTL_MS = 30 * 60_000;
export const MAX_DOCUMENTS = 100;

// Uploaded lease documents, kept in memory only (never written to disk) under a random
// `documentId`. Entries expire after `ttlMs` and at most `maxEntries` are kept (the oldest
// goes first), so lease contents do not pile up in a long-running server.
export function createDocumentStore({ ttlMs = DOCUMENT_TTL_MS, maxEntries = MAX_DOCUMENTS, now = Date.now } = {}) {
  const entries = new Map();

  function dropExpired() {
    const time = now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(id);
    }
  }

  function put(document) {
    dropExpired();
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    const documentId = randomUUID();
    const expiresAt = now() + ttlMs;
    entries.set(documentId, { document, expiresAt });
    return { documentId, expiresAt };
  }

  // The stored document, or undefined when the id is unknown or expired.
  function get(documentId) {
    const entry = entries.get(documentId);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(documentId);
      return undefined;
    }
    return entry.document;
  }

  return { put, get };
}

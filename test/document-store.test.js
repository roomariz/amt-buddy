import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentStore } from "../src/document-store.js";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

test("a stored document is found under the new id it gets", () => {
  const store = createDocumentStore();

  const first = store.put({ text: "Mietvertrag A" });
  const second = store.put({ text: "Mietvertrag B" });

  assert.notEqual(first.documentId, second.documentId);
  assert.deepEqual(store.get(first.documentId), { text: "Mietvertrag A" });
  assert.deepEqual(store.get(second.documentId), { text: "Mietvertrag B" });
  assert.equal(store.get("unknown"), undefined);
});

test("a document expires after the time to live", () => {
  const time = clock();
  const store = createDocumentStore({ ttlMs: 30 * 60_000, now: time.now });

  const { documentId, expiresAt } = store.put({ text: "Mietvertrag" });
  assert.equal(expiresAt, 1_000_000 + 30 * 60_000);

  time.advance(30 * 60_000 - 1);
  assert.ok(store.get(documentId), "still there just before it expires");
  time.advance(1);
  assert.equal(store.get(documentId), undefined);
});

test("the store keeps at most maxEntries documents, dropping the oldest", () => {
  const store = createDocumentStore({ maxEntries: 2 });

  const a = store.put({ text: "A" });
  const b = store.put({ text: "B" });
  const c = store.put({ text: "C" });

  assert.equal(store.get(a.documentId), undefined);
  assert.deepEqual(store.get(b.documentId), { text: "B" });
  assert.deepEqual(store.get(c.documentId), { text: "C" });
});

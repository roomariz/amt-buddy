import test from "node:test";
import assert from "node:assert/strict";

import { currentThreadId, startNewThread, THREAD_KEY } from "../../public/chat/thread.js";

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    items,
  };
}

const ids = (...list) => () => list.shift();

test("the first visit creates a thread id and keeps it", () => {
  const storage = memoryStorage();
  assert.equal(currentThreadId(storage, ids("t-1")), "t-1");
  assert.equal(storage.items.get(THREAD_KEY), "t-1");
});

test("a reload keeps the stored thread id", () => {
  const storage = memoryStorage({ [THREAD_KEY]: "t-old" });
  assert.equal(currentThreadId(storage, ids("t-new")), "t-old");
});

test("a new chat replaces the stored thread id", () => {
  const storage = memoryStorage({ [THREAD_KEY]: "t-old" });
  assert.equal(startNewThread(storage, ids("t-new")), "t-new");
  assert.equal(currentThreadId(storage, ids("t-other")), "t-new");
});

test("an unusable stored value is replaced", () => {
  const storage = memoryStorage({ [THREAD_KEY]: "x".repeat(201) });
  assert.equal(currentThreadId(storage, ids("t-1")), "t-1");
});

test("without working storage the thread id still works for this page", () => {
  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(currentThreadId(broken, ids("t-1")), "t-1");
  assert.equal(startNewThread(null, ids("t-2")), "t-2");
});

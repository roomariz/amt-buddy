// The conversation's threadId, kept in localStorage so a reload continues the same thread.
// Storage may be missing or throw (private mode, blocked site data): the id then lives only as
// long as the page.

export const THREAD_KEY = "amt-buddy.chatbot.threadId";
const MAX_ID_LENGTH = 200; // the chat endpoint's limit

function read(storage) {
  try {
    return storage?.getItem(THREAD_KEY) ?? null;
  } catch {
    return null;
  }
}

function write(storage, id) {
  try {
    storage?.setItem(THREAD_KEY, id);
  } catch {
    // Not persisted; the id still works until the page is left.
  }
}

// The stored thread id, or a new one (stored) when there is none.
export function currentThreadId(storage, makeId) {
  const stored = read(storage);
  if (typeof stored === "string" && stored.trim() && stored.length <= MAX_ID_LENGTH) return stored;
  return startNewThread(storage, makeId);
}

// A new chat: a new thread id, stored in place of the old one.
export function startNewThread(storage, makeId) {
  const id = makeId();
  write(storage, id);
  return id;
}

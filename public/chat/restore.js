// A restored conversation as a view model: the thread's Transcript (CONTEXT.md; fetchThread in
// ./api.js) turned into the bubbles the page draws after a reload. Pure.

const hasText = (entry) => typeof entry.text === "string" && entry.text.length > 0;

// → [{ kind: "user", text } | { kind: "bot", markdown }], in the Transcript's order. Entries with
// nothing to show (e.g. an empty user text) or of an unknown shape are left out.
export function restoredBubbles(transcript) {
  const bubbles = [];
  for (const entry of transcript) {
    if (!hasText(entry)) continue;
    if (entry.role === "user") bubbles.push({ kind: "user", text: entry.text });
    else if (entry.role === "assistant") bubbles.push({ kind: "bot", markdown: entry.text });
  }
  return bubbles;
}

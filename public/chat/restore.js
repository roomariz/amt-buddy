// A restored conversation as a view model: the thread's Transcript and Tenancy (CONTEXT.md;
// fetchThread in ./api.js) turned into what the page draws after a reload. No DOM; the page's own
// labels follow the current UI language (like ./tenancy.js), answers stay as written.

import { t } from "../i18n.js";
import { confirmedValuesText, reviewCard } from "./tenancy.js";

const hasText = (entry) => typeof entry.text === "string" && entry.text.length > 0;

// A user entry's bubble: the text as typed, the generic label of the lease chip (the server keeps
// no file name) and the confirmed values; null when it has nothing to show.
function userBubble(entry) {
  const text = hasText(entry) ? entry.text : "";
  const leaseLabel = entry.document === true ? t("chat.leaseUploaded") : null;
  const confirmed = entry.confirm && typeof entry.confirm === "object" ? confirmedValuesText(entry.confirm) : null;
  return text || leaseLabel || confirmed ? { kind: "user", text, leaseLabel, confirmed } : null;
}

// → { bubbles, review }. bubbles: [{ kind: "user", text, leaseLabel, confirmed } | { kind: "bot",
// markdown }] in the Transcript's order; entries with nothing to show or of an unknown shape are
// left out. review: the review card for the Tenancy's Unconfirmed facts, drawn under the last
// answer, or null (none left, or no answer to put it under).
export function restoredChat({ transcript, tenancy }) {
  const bubbles = [];
  for (const entry of transcript) {
    if (entry.role === "user") {
      const bubble = userBubble(entry);
      if (bubble) bubbles.push(bubble);
    } else if (entry.role === "assistant" && hasText(entry)) {
      bubbles.push({ kind: "bot", markdown: entry.text });
    }
  }
  const hasAnswer = bubbles.some((bubble) => bubble.kind === "bot");
  return { bubbles, review: hasAnswer ? reviewCard(tenancy) : null };
}

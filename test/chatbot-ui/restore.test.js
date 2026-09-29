import test from "node:test";
import assert from "node:assert/strict";

import { restoredBubbles } from "../../public/chat/restore.js";

test("a Transcript becomes the user and bot bubbles, in order", () => {
  const transcript = [
    { role: "user", text: "Can you check my rent?", document: false, confirm: null },
    { role: "assistant", text: "Tell me your **address**.\n\n_Not legal advice._" },
    { role: "user", text: "A poem, please", document: false, confirm: null },
    { role: "assistant", text: "I can only help with Berlin housing questions." },
    { role: "user", text: "Hello?", document: false, confirm: null },
  ];
  assert.deepEqual(restoredBubbles(transcript), [
    { kind: "user", text: "Can you check my rent?" },
    { kind: "bot", markdown: "Tell me your **address**.\n\n_Not legal advice._" },
    { kind: "user", text: "A poem, please" },
    { kind: "bot", markdown: "I can only help with Berlin housing questions." },
    { kind: "user", text: "Hello?" },
  ]);
});

test("an empty Transcript draws nothing", () => {
  assert.deepEqual(restoredBubbles([]), []);
});

test("entries with nothing to show or of an unknown shape are skipped", () => {
  assert.deepEqual(
    restoredBubbles([
      { role: "user", text: "", document: false, confirm: null },
      { role: "assistant", text: "" },
      { role: "system", text: "internal" },
      { role: "user", text: 42 },
      { role: "assistant", text: "Hi." },
    ]),
    [{ kind: "bot", markdown: "Hi." }],
  );
});

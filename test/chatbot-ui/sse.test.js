import test from "node:test";
import assert from "node:assert/strict";

import { createSseParser } from "../../public/chat/sse.js";

test("parses complete SSE messages into their event objects", () => {
  const parser = createSseParser();
  const events = parser.push(
    'event: intent\ndata: {"type":"intent","intents":["mietspiegel"]}\n\n' +
      'event: done\ndata: {"type":"done"}\n\n',
  );
  assert.deepEqual(events, [{ type: "intent", intents: ["mietspiegel"] }, { type: "done" }]);
});

test("keeps a message split across chunks until its blank line arrives", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: token\ndata: {"type":"tok'), []);
  assert.deepEqual(parser.push('en","text":"Hallo"}\n'), []);
  assert.deepEqual(parser.push("\n"), [{ type: "token", text: "Hallo" }]);
});

test("ignores keep-alive comments and accepts CRLF line endings", () => {
  const parser = createSseParser();
  const events = parser.push(': keep-alive\n\nevent: done\r\ndata: {"type":"done"}\r\n\r\n');
  assert.deepEqual(events, [{ type: "done" }]);
});

test("joins multi-line data and takes the type from the event field when the data has none", () => {
  const parser = createSseParser();
  const events = parser.push('event: token\ndata: {"text":\ndata: "a"}\n\n');
  assert.deepEqual(events, [{ type: "token", text: "a" }]);
});

test("skips messages whose data is not JSON", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push("event: token\ndata: not json\n\nevent: done\ndata: {\"type\":\"done\"}\n\n"), [
    { type: "done" },
  ]);
});

test("flush() returns a last message the stream ended without a blank line", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: done\ndata: {"type":"done"}'), []);
  assert.deepEqual(parser.flush(), [{ type: "done" }]);
});

test("a CRLF split between two chunks is still one line break", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: done\r\ndata: {"type":"done"}\r'), []);
  assert.deepEqual(parser.push("\n\r\n"), [{ type: "done" }]);
});

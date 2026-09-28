import test from "node:test";
import assert from "node:assert/strict";

import { fetchChatMode, runTurn, uploadLease, UPLOAD_TEXT } from "../../public/chat/api.js";
import { TURN_TEXT } from "../../public/chat/turn.js";

// A fetch that answers every call with the given Response factory, recording the requests.
function fakeFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return respond(url, init);
  };
  return { fetchImpl, calls };
}

// A text/event-stream Response delivered in the given chunks.
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the chat mode comes from the status endpoint; unknown when it cannot be read", async () => {
  const ok = fakeFetch(() => json(200, { data: { mode: "rule_based" } }));
  assert.equal(await fetchChatMode(ok.fetchImpl), "rule_based");
  assert.equal(ok.calls[0].url, "/api/v1/orchestrator/status");

  const down = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  assert.equal(await fetchChatMode(down.fetchImpl), null);
});

test("a turn posts the request and folds the streamed events, reporting every change", async () => {
  const { fetchImpl, calls } = fakeFetch(() =>
    sseResponse([
      'event: intent\ndata: {"type":"intent","intents":["mietspiegel"]}\n\n: keep-alive\n\n',
      'event: agent_step\ndata: {"type":"agent_step","agent":"ComplianceAgent","status":"started"}\n\nevent: tok',
      'en\ndata: {"type":"token","text":"**474–690 €**"}\n\nevent: done\ndata: {"type":"done"}\n\n',
    ]),
  );
  const seen = [];
  const state = await runTurn({
    fetchImpl,
    request: { threadId: "t-1", message: "Mietspiegel?" },
    onChange: (next) => seen.push(next.phase + ":" + next.steps.length),
  });

  assert.equal(calls[0].url, "/api/v1/orchestrator/chat");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, { threadId: "t-1", message: "Mietspiegel?" });
  assert.equal(state.phase, "done");
  assert.equal(state.answer, "**474–690 €**");
  assert.deepEqual(seen, ["streaming:0", "streaming:1", "streaming:1", "done:1"]);
});

test("a rejected request or a broken connection ends the turn with a friendly error", async () => {
  const rejected = fakeFetch(() => json(422, { error: { code: "validation_error", message: "'threadId' must be…" } }));
  const state = await runTurn({ fetchImpl: rejected.fetchImpl, request: { threadId: "", message: "x" } });
  assert.equal(state.phase, "error");
  assert.equal(state.error, TURN_TEXT.failed);

  const offline = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const lost = await runTurn({ fetchImpl: offline.fetchImpl, request: { threadId: "t", message: "x" } });
  assert.equal(lost.error, TURN_TEXT.connectionLost);

  const cut = fakeFetch(() => sseResponse(['event: agent_step\ndata: {"type":"agent_step","agent":"OfficialDataAgent","status":"started"}\n\n']));
  const unfinished = await runTurn({ fetchImpl: cut.fetchImpl, request: { threadId: "t", message: "x" } });
  assert.equal(unfinished.error, TURN_TEXT.connectionLost);
  assert.equal(unfinished.steps[0].status, "failed");
});

test("an upload returns the documentId", async () => {
  const { fetchImpl, calls } = fakeFetch(() =>
    json(201, { data: { documentId: "doc-1", expiresAt: "2026-09-28T18:30:00.000Z", extraction: {} } }),
  );
  const payload = { file: "SGFsbG8=", mimeType: "text/plain", fileName: "lease.txt" };
  assert.deepEqual(await uploadLease({ fetchImpl, payload }), { documentId: "doc-1" });
  assert.equal(calls[0].url, "/api/v1/orchestrator/documents");
  assert.deepEqual(calls[0].body, payload);
});

test("an upload the server cannot read gives a friendly reason", async () => {
  const cases = [
    ["ocr_no_text", UPLOAD_TEXT.noTextLayer],
    ["image_ocr_provider_required", UPLOAD_TEXT.image],
    ["file_too_large", UPLOAD_TEXT.tooLarge],
    ["empty_text", UPLOAD_TEXT.empty],
    ["something_else", UPLOAD_TEXT.failed],
  ];
  for (const [code, text] of cases) {
    const { fetchImpl } = fakeFetch(() =>
      json(422, { error: { code: "ocr_extraction_error", message: "technical", details: [{ field: "file", code }] } }),
    );
    await assert.rejects(uploadLease({ fetchImpl, payload: { text: "x" } }), { message: text });
  }
  const { fetchImpl } = fakeFetch(() => json(500, { error: { code: "internal_error" } }));
  await assert.rejects(uploadLease({ fetchImpl, payload: { text: "x" } }), { message: UPLOAD_TEXT.failed });
});

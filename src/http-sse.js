// Server-Sent Events for the chat endpoints (the tenant and the landlord chat share them).

const SSE_HEARTBEAT_MS = 15_000;
const CHAT_FAILED = "Amt-Buddy could not answer this message.";

// Writes one turn's events as Server-Sent Events: `event: <type>` and `data: <the event as JSON>`.
// Stops, and aborts the run (`abort`, an AbortController), when the client disconnects.
export async function streamEvents(response, events, abort) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
  let closed = false;
  // An SSE comment now and then keeps proxies from closing a turn that waits on slow Tools.
  const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), SSE_HEARTBEAT_MS);
  response.on("close", () => {
    clearInterval(heartbeat);
    if (response.writableFinished) return;
    closed = true;
    abort.abort();
  });
  const write = (event) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  try {
    for await (const event of events) {
      if (closed) break;
      write(event);
    }
  } catch (error) {
    // The event sources end every turn with done or error themselves; this is the safety net.
    console.error("Chat turn failed:", error?.name ?? "Error");
    if (!closed) write({ type: "error", message: CHAT_FAILED });
  } finally {
    clearInterval(heartbeat);
    if (!closed) response.end();
  }
}

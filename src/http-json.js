// The JSON helpers every HTTP handler shares: the `{ data }` / `{ error: { code, message, details? } }` shape.

export function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

// Reads a JSON request body of at most `maxBytes`; a body too large or not JSON throws
// `new ErrorClass(details)` with the usual validation details.
export async function readJson(request, maxBytes, ErrorClass) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new ErrorClass([
        { field: "body", code: "too_large", message: `Request body exceeds limit of ${maxBytes} bytes.` },
      ]);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ErrorClass([
      { field: "body", code: "invalid_json", message: "Request body must be valid JSON." },
    ]);
  }
}

export function sendError(response, status, code, message, details) {
  sendJson(response, status, { error: details ? { code, message, details } : { code, message } });
}

// Parses the Orchestrator's Server-Sent Events stream (POST, so read with fetch, not EventSource).
// Each message is `event: <type>` + `data: <the whole event as JSON>`, ended by a blank line;
// lines starting with ":" are keep-alive comments.
//
// const parser = createSseParser();
// for each decoded text chunk: for (const event of parser.push(chunk)) …
// at the end of the stream:    for (const event of parser.flush()) …
export function createSseParser() {
  let buffer = "";
  let pendingCr = "";

  function parseMessage(block) {
    let type;
    const data = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") type = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) return null;
    let event;
    try {
      event = JSON.parse(data.join("\n"));
    } catch {
      return null;
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) return null;
    if (typeof event.type !== "string" && type) event.type = type;
    return typeof event.type === "string" ? event : null;
  }

  function take(blocks) {
    return blocks.map(parseMessage).filter(Boolean);
  }

  return {
    push(chunk) {
      // A "\r" at the end of a chunk may be the first half of a "\r\n": keep it for the next one.
      const text = pendingCr + chunk;
      pendingCr = text.endsWith("\r") ? "\r" : "";
      buffer += (pendingCr ? text.slice(0, -1) : text).replace(/\r\n?/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop();
      return take(blocks);
    },
    flush() {
      const rest = buffer;
      buffer = "";
      pendingCr = "";
      return rest.trim() ? take([rest]) : [];
    },
  };
}

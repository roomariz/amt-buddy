import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { AddressInputError, verifyBerlinAddress } from "./berlin-address.js";
import { processChat } from "./chatbot-orchestrator.js";
import { createDocumentStore } from "./document-store.js";
import { OccupancyInputError } from "./occupancy-assessment.js";
import { DocumentOcrError, extractDocumentText, parseTenancyDocument, processDocumentOcr } from "./ocr-extraction.js";
import { createBerlinTools } from "./orchestrator/berlin-tools.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { createOpenAIModels } from "./orchestrator/openai.js";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 16_384, ErrorClass = AddressInputError) {
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

async function handleVerification(request, response) {
  try {
    const input = await readJson(request);
    const result = await verifyBerlinAddress(input);
    sendJson(response, 200, { data: result });
  } catch (error) {
    if (error instanceof AddressInputError || error instanceof OccupancyInputError) {
      sendJson(response, 422, {
        error: {
          code: "validation_error",
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    console.error(error);
    sendJson(response, 502, {
      error: {
        code: "berlin_data_service_unavailable",
        message: "An official Berlin data service is temporarily unavailable.",
      },
    });
  }
}

async function handleDocumentOcr(request, response) {
  try {
    const input = await readJson(request, 20 * 1024 * 1024, DocumentOcrError);
    const result = await processDocumentOcr(input);
    sendJson(response, 200, { data: result });
  } catch (error) {
    if (error instanceof DocumentOcrError) {
      sendJson(response, 422, {
        error: {
          code: "ocr_extraction_error",
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    console.error(error);
    sendJson(response, 500, {
      error: {
        code: "internal_error",
        message: "Failed to process document OCR extraction.",
      },
    });
  }
}

async function handleChat(request, response) {
  try {
    const input = await readJson(request, 1024 * 1024);
    if (!input || !input.message) {
      sendJson(response, 422, {
        error: {
          code: "validation_error",
          message: "Field 'message' is required in chat request body.",
        },
      });
      return;
    }

    const result = await processChat(input);
    sendJson(response, 200, { data: result });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: {
        code: "chat_orchestrator_error",
        message: "Failed to process chat query.",
      },
    });
  }
}

async function serveStatic(pathname, response) {
  let relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (relativePath === "chatbot" || relativePath === "chat") {
    relativePath = "chatbot.html";
  }
  const filePath = normalize(join(publicDirectory, relativePath));

  if (!filePath.startsWith(publicDirectory)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

// The Orchestrator answers the chat when both OPENAI_MODEL and OPENAI_API_KEY are set;
// otherwise the rule-based chatbot (processChat) does.
export function chatMode(env) {
  return env.OPENAI_MODEL?.trim() && env.OPENAI_API_KEY?.trim() ? "orchestrator" : "rule_based";
}

function defaultChatOrchestrator({ env, documents }) {
  return createOrchestrator({ models: createOpenAIModels(env), tools: createBerlinTools({ documents }).tools });
}

const SSE_HEARTBEAT_MS = 15_000;
const CHAT_FAILED = "Amt-Buddy could not answer this message.";
const MAX_ID_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4_000;

function sendError(response, status, code, message, details) {
  sendJson(response, status, { error: details ? { code, message, details } : { code, message } });
}

class ChatInputError extends Error {
  constructor(details) {
    super(details[0]?.message ?? "Chat request is invalid.");
    this.name = "ChatInputError";
    this.details = details;
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Checks a chat turn's body; returns the validation problems (none: the turn can run).
function chatTurnProblems(input) {
  if (!isPlainObject(input)) return [{ field: "body", code: "invalid_type", message: "Body must be a JSON object." }];
  const { threadId, message, documentId, confirm } = input;
  const problems = [];
  const optionalString = (field, value, max) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string" || value.length > max) {
      problems.push({ field, code: "invalid_type", message: `'${field}' must be a string of at most ${max} characters.` });
    }
  };
  if (typeof threadId !== "string" || !threadId.trim() || threadId.length > MAX_ID_LENGTH) {
    problems.push({ field: "threadId", code: "required", message: "'threadId' must be a non-empty string." });
  }
  optionalString("message", message, MAX_MESSAGE_LENGTH);
  optionalString("documentId", documentId, MAX_ID_LENGTH);
  if (confirm !== undefined && confirm !== null && !isPlainObject(confirm)) {
    problems.push({ field: "confirm", code: "invalid_type", message: "'confirm' must be an object of fact values." });
  }
  const hasContent = (typeof message === "string" && message.trim()) || documentId || isPlainObject(confirm);
  if (problems.length === 0 && !hasContent) {
    problems.push({ field: "message", code: "required", message: "Send a 'message', a 'documentId' or 'confirm'." });
  }
  return problems;
}

// Writes one turn's events as Server-Sent Events: `event: <type>` and `data: <the event as JSON>`.
// Stops, and aborts the run, when the client disconnects.
async function streamEvents(response, events, abort) {
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

// The rule-based chatbot's reply for one turn, as the same events the Orchestrator yields.
async function* ruleBasedTurn({ message, documentId }, documents) {
  try {
    const context = {};
    if (documentId) {
      const document = documents.get(documentId);
      if (!document) {
        yield {
          type: "token",
          text: "Das hochgeladene Dokument ist nicht mehr verfügbar. Bitte laden Sie es erneut hoch.",
        };
        yield { type: "done" };
        return;
      }
      context.hasFile = true;
      context.fileText = document.text;
    }
    const { reply } = await processChat({ message: message ?? "", context });
    yield { type: "token", text: reply };
    yield { type: "done" };
  } catch (error) {
    console.error("Rule-based chat failed:", error?.name ?? "Error");
    yield { type: "error", message: CHAT_FAILED };
  }
}

// createApp({ env?, documents?, createChatOrchestrator? }) → an http.Server, not yet listening.
// - env: decides the chat mode (see chatMode); default process.env.
// - documents: the in-memory store of uploaded leases (default: 30 min, at most 100).
// - createChatOrchestrator({ env, documents }): builds the one Orchestrator of this server,
//   lazily on the first chat turn (default: OpenAI models from env + the real Berlin Tools).
export function createApp({
  env = process.env,
  documents = createDocumentStore(),
  createChatOrchestrator = defaultChatOrchestrator,
} = {}) {
  const mode = chatMode(env);
  let orchestrator;
  const getOrchestrator = () => (orchestrator ??= createChatOrchestrator({ env, documents }));

  async function handleOrchestratorChat(request, response) {
    let input;
    try {
      input = await readJson(request, 1024 * 1024, ChatInputError);
    } catch (error) {
      // Anything but a bad body means the request stream broke (e.g. the client went away).
      if (!(error instanceof ChatInputError)) {
        response.destroy();
        return;
      }
      sendError(response, 422, "validation_error", error.message, error.details);
      return;
    }
    const problems = chatTurnProblems(input);
    if (problems.length > 0) {
      sendError(response, 422, "validation_error", problems[0].message, problems);
      return;
    }

    const turn = {
      threadId: input.threadId,
      message: input.message ?? undefined,
      documentId: input.documentId ?? undefined,
      confirm: input.confirm ?? undefined,
    };
    const abort = new AbortController();
    const events =
      mode === "orchestrator" ? orchestratorTurn(turn, abort.signal) : ruleBasedTurn(turn, documents);
    await streamEvents(response, events, abort);
  }

  async function* orchestratorTurn(turn, signal) {
    let chat;
    try {
      chat = getOrchestrator();
    } catch (error) {
      console.error("The Orchestrator could not be created:", error.message);
      yield { type: "error", message: "Amt-Buddy's AI chat is not available right now." };
      return;
    }
    yield* chat.send({ ...turn, signal });
  }

  async function handleDocumentUpload(request, response) {
    try {
      const input = await readJson(request, 20 * 1024 * 1024, DocumentOcrError);
      const text = await extractDocumentText(input);
      const extraction = parseTenancyDocument(text);
      const { documentId, expiresAt } = documents.put({ extraction, text });
      sendJson(response, 201, { data: { documentId, expiresAt: new Date(expiresAt).toISOString(), extraction } });
    } catch (error) {
      if (error instanceof DocumentOcrError) {
        sendError(response, 422, "ocr_extraction_error", error.message, error.details);
        return;
      }
      // Log the failure only: the error never includes the lease's contents.
      console.error("Lease upload failed:", error?.name ?? "Error");
      sendError(response, 500, "internal_error", "Failed to process the uploaded document.");
    }
  }

  async function route(request, response) {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "POST" && url.pathname === "/api/v1/address-verifications") {
      await handleVerification(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents/ocr") {
      await handleDocumentOcr(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/chat") {
      await handleChat(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/orchestrator/chat") {
      await handleOrchestratorChat(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/orchestrator/documents") {
      await handleDocumentUpload(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/orchestrator/status") {
      sendJson(response, 200, { data: { mode } });
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    response.writeHead(405, { allow: "GET, POST" }).end();
  }

  return createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      // A handler that throws must not take the server down (unhandled rejection).
      console.error("Request failed:", error?.name ?? "Error");
      if (!response.headersSent) sendError(response, 500, "internal_error", "The request could not be handled.");
      else response.destroy();
    }
  });
}

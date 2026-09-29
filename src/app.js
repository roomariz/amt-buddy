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
import { readJson as readJsonBody, sendError, sendJson } from "./http-json.js";
import { CHAT_FAILED, streamEvents } from "./http-sse.js";
import { createLandlordApi } from "./landlord/http.js";
import { createLandlordOrchestrator, createLandlordStubTools } from "./landlord/orchestrator/index.js";
import { createLandlordStore, landlordDatabasePath } from "./landlord/store.js";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const readJson = (request, maxBytes = 16_384, ErrorClass = AddressInputError) =>
  readJsonBody(request, maxBytes, ErrorClass);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

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
  let relativePath = pathname.slice(1);
  if (relativePath === "" || relativePath === "chatbot" || relativePath === "chat") {
    relativePath = "chatbot.html";
  }
  if (relativePath === "landlord") relativePath = "landlord.html";
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

// The Landlord Orchestrator runs on the stub Tools until the real landlord Tools exist.
function defaultLandlordChat({ env, getContext }) {
  return createLandlordOrchestrator({
    model: createOpenAIModels(env).supervisor,
    tools: createLandlordStubTools().tools,
    getContext,
  });
}

const MAX_ID_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4_000;
const THREAD_PATH = "/api/v1/orchestrator/threads/";
const EMPTY_THREAD = { transcript: [], tenancy: {} };


class ChatInputError extends Error {
  constructor(details) {
    super(details[0]?.message ?? "Chat request is invalid.");
    this.name = "ChatInputError";
    this.details = details;
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The rule for a threadId, shared by the chat and thread endpoints; null when it holds.
function threadIdProblem(threadId) {
  if (typeof threadId === "string" && threadId.trim() && threadId.length <= MAX_ID_LENGTH) return null;
  return { field: "threadId", code: "required", message: "'threadId' must be a non-empty string." };
}

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
  const threadProblem = threadIdProblem(threadId);
  if (threadProblem) problems.push(threadProblem);
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

// createApp({ env?, documents?, createChatOrchestrator?, landlordStore?, fetchImpl?, createLandlordChat? }) → an
// http.Server, not yet listening.
// - env: decides the chat mode (see chatMode) and the landlord database path; default process.env.
// - documents: the in-memory store of uploaded leases (default: 30 min, at most 100).
// - createChatOrchestrator({ env, documents }): builds the one Orchestrator of this server,
//   lazily on the first chat turn (default: OpenAI models from env + the real Berlin Tools).
// - landlordStore: the landlord store (default: SQLite at landlordDatabasePath(env), opened on
//   the first landlord request).
// - fetchImpl: the fetch the landlord side uses for the Berlin services (default: global fetch).
// - createLandlordChat({ env, getContext }): builds the Landlord Orchestrator, lazily on the first
//   landlord chat turn and only when a model is configured (see chatMode); `getContext` loads a
//   landlord's state for its system prompt (default: OpenAI model from env + the stub landlord Tools).
export function createApp({
  env = process.env,
  documents = createDocumentStore(),
  createChatOrchestrator = defaultChatOrchestrator,
  landlordStore,
  fetchImpl,
  createLandlordChat = defaultLandlordChat,
} = {}) {
  const mode = chatMode(env);
  let store = landlordStore;
  const getStore = () => (store ??= createLandlordStore({ path: landlordDatabasePath(env) }));
  let landlordChat;
  const landlordApi = createLandlordApi({
    getStore,
    fetchImpl,
    getChat: () =>
      mode === "orchestrator"
        ? (landlordChat ??= createLandlordChat({ env, getContext: async (landlordId) => ({ listing: getStore().getListing(landlordId) }) }))
        : null,
  });
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

  // GET /api/v1/orchestrator/threads/:threadId → the thread's Transcript and Tenancy. Never
  // creates the Orchestrator: without one (rule_based mode, or no chat turn yet) nothing is
  // remembered. Logs no content.
  async function handleThread(response, encodedId) {
    let threadId;
    try {
      threadId = decodeURIComponent(encodedId);
    } catch {
      threadId = "";
    }
    const problem = threadIdProblem(threadId);
    if (problem) {
      sendError(response, 422, "validation_error", problem.message, [problem]);
      return;
    }
    const thread = mode === "orchestrator" && orchestrator ? await orchestrator.getThread(threadId) : EMPTY_THREAD;
    sendJson(response, 200, { data: thread });
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

    if (await landlordApi.handle(request, response, url)) return;

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

    if (request.method === "GET" && url.pathname.startsWith(THREAD_PATH)) {
      await handleThread(response, url.pathname.slice(THREAD_PATH.length));
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

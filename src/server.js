import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { AddressInputError, verifyBerlinAddress } from "./berlin-address.js";
import { listenOnAvailablePort, PortUnavailableError } from "./listen.js";
import { OccupancyInputError } from "./occupancy-assessment.js";
import { DocumentOcrError, processDocumentOcr } from "./ocr-extraction.js";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const configuredPort = process.env.PORT;
const preferredPort = Number(configuredPort ?? 3000);
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

async function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "POST" && url.pathname === "/api/v1/address-verifications") {
    await handleVerification(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/documents/ocr") {
    await handleDocumentOcr(request, response);
    return;
  }

  if (request.method === "GET") {
    await serveStatic(url.pathname, response);
    return;
  }

  response.writeHead(405, { allow: "GET, POST" }).end();
});

if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65_535) {
  console.error("PORT must be an integer between 0 and 65535.");
  process.exitCode = 1;
} else {
  try {
    const address = await listenOnAvailablePort(server, {
      startPort: preferredPort,
      endPort: configuredPort ? preferredPort : preferredPort + 10,
    });

    if (address.port !== preferredPort) {
      console.warn(`Port ${preferredPort} is in use; using ${address.port} instead.`);
    }
    console.log(`Amt Buddy is running at http://${address.host}:${address.port}`);
  } catch (error) {
    if (error instanceof PortUnavailableError) {
      console.error(`${error.message} Stop the process using that port or set PORT explicitly.`);
    } else {
      console.error("Amt Buddy could not start:", error);
    }
    process.exitCode = 1;
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { listenOnAvailablePort, PortUnavailableError } from "../src/listen.js";

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function listenOnRandomPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("uses the preferred port when it is available", async () => {
  const server = createServer();

  try {
    const address = await listenOnAvailablePort(server, { startPort: 0, endPort: 0 });
    assert.equal(address.host, "127.0.0.1");
    assert.ok(address.port > 0);
  } finally {
    await close(server);
  }
});

test("falls back when the preferred port is already occupied", async () => {
  const occupiedServer = createServer();
  const occupiedPort = await listenOnRandomPort(occupiedServer);
  const server = createServer();

  try {
    const address = await listenOnAvailablePort(server, {
      startPort: occupiedPort,
      endPort: occupiedPort + 10,
    });
    assert.notEqual(address.port, occupiedPort);
  } finally {
    await close(server);
    await close(occupiedServer);
  }
});

test("returns a typed error when fallback is disabled", async () => {
  const occupiedServer = createServer();
  const occupiedPort = await listenOnRandomPort(occupiedServer);
  const server = createServer();

  try {
    await assert.rejects(
      listenOnAvailablePort(server, {
        startPort: occupiedPort,
        endPort: occupiedPort,
      }),
      (error) => error instanceof PortUnavailableError && error.code === "PORT_UNAVAILABLE",
    );
  } finally {
    await close(occupiedServer);
  }
});

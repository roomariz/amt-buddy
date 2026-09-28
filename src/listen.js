export class PortUnavailableError extends Error {
  constructor(startPort, endPort, cause) {
    const range = startPort === endPort ? `${startPort}` : `${startPort}–${endPort}`;
    super(`No available local port in range ${range}.`, { cause });
    this.name = "PortUnavailableError";
    this.code = "PORT_UNAVAILABLE";
    this.startPort = startPort;
    this.endPort = endPort;
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

export async function listenOnAvailablePort(
  server,
  { startPort = 3000, endPort = startPort, host = "127.0.0.1" } = {},
) {
  let lastError;

  for (let port = startPort; port <= endPort; port += 1) {
    try {
      await listen(server, port, host);
      return { port: server.address().port, host };
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
      lastError = error;
    }
  }

  throw new PortUnavailableError(startPort, endPort, lastError);
}

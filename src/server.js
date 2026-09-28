import { createApp } from "./app.js";
import { listenOnAvailablePort, PortUnavailableError } from "./listen.js";

const configuredPort = process.env.PORT;
const preferredPort = Number(configuredPort ?? 3000);
const server = createApp();

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

/**
 * HayzenXcr — Agent Games agent endpoint (persistent server entrypoint).
 *
 * node:http only (no web framework). One process, one port.
 * All request logic lives in src/handler.ts (shared with the Vercel
 * Serverless Function in api/index.ts); this file only builds the context
 * and listens. See src/handler.ts for the routes and fail-closed rules.
 */
import { createAgentServer, createContext } from "./handler.js";

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

function main(): void {
  const ctx = createContext();
  const server = createAgentServer(ctx);
  server.listen(ctx.config.port, "0.0.0.0", () => {
    log(
      `HayzenXcr Agent Games endpoint listening on 0.0.0.0:${ctx.config.port} (POST /agent, GET /health)`,
    );
  });
}

main();
